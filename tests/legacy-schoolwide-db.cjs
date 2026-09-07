// Explicitly bound to the disposable Neon clone, never production.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { neon } = require('@neondatabase/serverless');
const { withNeonTransaction } = require('../api/_db-transaction');
const { bookFlexiblePackageSlotTransaction, cancelFlexiblePackageBookingTransaction,
  moveFlexiblePackageBookingAllocations } = require('../api/_flexible-package-ledger');

async function main() {
  const connectionString = process.env.LEGACY_TEST_DATABASE_URL;
  assert.equal(process.env.LEGACY_TEST_BRANCH, 'br-fancy-breeze-abmk6in7');
  assert.equal(new URL(connectionString).hostname, 'ep-royal-frog-ab6urteh-pooler.eu-west-2.aws.neon.tech');
  const sql = neon(connectionString);
  const unfinished = await sql("SELECT id,learner_id FROM lesson_bookings WHERE school_id=1 AND learner_id IN (34,74) AND scheduled_date IN ('2030-01-07','2030-01-08') AND status='scheduled' AND payment_method='flexible_package'");
  for (const b of unfinished) await cancelFlexiblePackageBookingTransaction({connectionString,learnerId:b.learner_id,schoolId:1,bookingId:b.id,eligibleReturn:true});
  for (const [learner, rate] of [[34,4800],[74,4983.25]]) {
    const [balance] = await sql('SELECT balance_minutes FROM learner_credit_balances WHERE school_id=1 AND learner_id=$1 AND instructor_id=4',[learner]);
    if (balance.balance_minutes === 0) continue;
    const request = crypto.randomUUID();
    const args = [1,learner,4,1,rate,'Isolated integration fixture; owner-confirmed original purchase rate',request];
    const [preview] = await sql('SELECT convert_legacy_credit_to_schoolwide_hours($1,$2,$3,$4,$5,$6,$7) AS result',args);
    const applyArgs = [...args,true,preview.result.conversion.fingerprint];
    const results = await Promise.all([1,2].map(()=>sql('SELECT convert_legacy_credit_to_schoolwide_hours($1,$2,$3,$4,$5,$6,$7,$8,$9) AS result',applyArgs)));
    assert.equal(results[0][0].result.source_id,results[1][0].result.source_id);
    assert.equal(results.filter(r=>r[0].result.reused).length,1);
  }
  const [type] = await sql('SELECT id FROM lesson_types WHERE school_id=1 AND duration_minutes=90 ORDER BY id LIMIT 1');
  assert.ok(type);
  for (const [learner, starting, expectedPence] of [[34,180,7200],[74,424,7475]]) {
    const args = {connectionString,learnerId:learner,instructorId:6,schoolId:1,
      date:'2030-01-07',startTime:learner===34?'03:00':'05:00',endTime:learner===34?'04:30':'06:30',
      lessonTypeId:type.id,durationMinutes:90,pickupAddress:'Test',dropoffAddress:'Test',clientRequestId:crypto.randomUUID()};
    const booked=await bookFlexiblePackageSlotTransaction(args);
    assert.equal(booked.ok,true,JSON.stringify(booked));
    assert.equal(booked.contributionPence,expectedPence);
    assert.equal(Math.round(booked.remainingUnits*30),starting-90);
    const retry=await bookFlexiblePackageSlotTransaction(args);
    assert.equal(retry.ok,true);
    assert.equal(retry.reused,true);
    assert.equal(Math.round(retry.remainingUnits*30),starting-90);
    const [oldBalance]=await sql('SELECT balance_minutes FROM learner_credit_balances WHERE school_id=1 AND learner_id=$1 AND instructor_id=4',[learner]);
    assert.equal(oldBalance.balance_minutes,0);
    await withNeonTransaction(connectionString, async client=>{
      const replacement=await client.query(`INSERT INTO lesson_bookings(learner_id,instructor_id,school_id,scheduled_date,start_time,end_time,status,minutes_deducted,payment_method,list_price_pence,list_price_source)
        VALUES($1,5,1,'2030-01-08',$2,$3,'scheduled',90,'flexible_package',$4,'flexible_package_frozen_rate') RETURNING id`,[learner,args.startTime,args.endTime,expectedPence]);
      const moved=await moveFlexiblePackageBookingAllocations(client,{learnerId:learner,schoolId:1,oldBookingId:booked.booking.id,newBookingId:replacement.rows[0].id,newInstructorId:5});
      assert.equal(moved.minutes,90);assert.equal(moved.contributionPence,expectedPence);
      await client.query("UPDATE lesson_bookings SET status='refunded' WHERE school_id=1 AND id=$1",[booked.booking.id]);
      booked.booking.id=replacement.rows[0].id;
    });
    const cancelled=await cancelFlexiblePackageBookingTransaction({connectionString,learnerId:learner,schoolId:1,bookingId:booked.booking.id,eligibleReturn:true});
    assert.equal(cancelled.minutesReturned,90);
    assert.equal(Math.round(cancelled.remainingUnits*30),starting);
    const repeatCancel=await cancelFlexiblePackageBookingTransaction({connectionString,learnerId:learner,schoolId:1,bookingId:booked.booking.id,eligibleReturn:true});
    assert.equal(repeatCancel.idempotent,true);
    assert.equal(Math.round(repeatCancel.remainingUnits*30),starting);
  }
  console.log('PASS: concurrent conversion/replay, cross-instructor booking/retry, frozen prices, cross-instructor move, cancellation/retry, exact balances');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
