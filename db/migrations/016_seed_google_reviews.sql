-- Seed Google Reviews from business profile (captured 2026-03-22)
-- 13 reviews, all 5 stars, overall rating 5.0

DELETE FROM google_reviews;
DELETE FROM google_reviews_meta;

INSERT INTO google_reviews (review_id, author_name, rating, text, relative_time, publish_time) VALUES
('oberah_qadeer_2026-03-22', 'Oberah Qadeer', 5,
 'Fraser came to the rescue as my daughter''s driving instructor unfortunately became ill. Great teaching and flexibility for lessons. My daughter passed with only two minors. Fraser is a fantastic instructor who I would highly recommend.',
 '5 hours ago', '2026-03-22'),

('olivia_may_2026-03-01', 'Olivia May', 5,
 'Fraser is a fantastic instructor and was the driving force behind me passing with only 1 minor today! He really put me at ease from my first lesson, which meant I was able to fully focus on refining my skills and learning the key things I needed to in order to feel comfortable and confident behind the wheel. His constructive criticism was clear and kind, and I never felt patronised or like I was in trouble! I ended up looking forward to my lessons instead of dreading them and any nerves I previously had about driving went away. Booking in my lessons was also very easy and straightforward and communication between my lessons was also a breeze. Thank you again Fraser!',
 '3 weeks ago', '2026-03-01'),

('pete_humphries_2026-02-15', 'Pete Humphries', 5,
 'I''d failed 9 times and almost gave up on driving altogether, but decided to give it one last go, and try Coach Carter. I assumed Fraser would be the same as other instructors I''d had on and off over the years, but I was completely blown away by his teaching methods and his character. Where other instructors often sit back and give you stuff to memorise and motions to go through, Fraser got me to think through exactly what I should be mindful of at what point, and why - thinking about the reasons behind actions, not just what to do in each circumstance. Thanks to this systematised learning process, his encouraging, conversational teaching style and his completely unflappable demeanour- in just a few lessons I went from a liability on the road, to passing on the first try! I honestly cannot recommend this instructor enough. Book him.',
 '5 weeks ago', '2026-02-15'),

('andrew_brown_2026-02-08', 'Andrew Brown', 5,
 'Passed first time. What else is there to say? Quite a lot actually. Fraser was knowledgeable, calm, relaxed, patient whilst guiding me towards independence and challenging me to be a better driver. I recommend.',
 '6 weeks ago', '2026-02-08'),

('zoe_read_2025-09-14', 'Zoe Read', 5,
 '1000000/10 recommend Coach Carter to anyone and everyone that will listen! (Seriously I''ve been telling everybody!) Fraser was so calm, friendly, patient, helpful and reassuring - I had some previous experience driving prior to covid, however due to the time passed without driving, I was extremely nervous getting on the road again. Fraser really cared and listened to my concerns and fears, whilst helping me overcome them every single step of the way. Every lesson we had together was a breeze, I felt so comfortable and we laughed almost every minute of the hours that we spent together. On the test day, he helped to calm my nerves massively and reassure me which led me to pass first time! I definitely couldn''t have done it without him :) Thank you so much for all your help to get me on the road, and I wish you all the best!!',
 '27 weeks ago', '2025-09-14'),

('jayde_davis_2025-05-18', 'jayde davis', 5,
 'The BEST instructor. I have a lot of anxiety and have always struggled with finding a good instructor. Fraser is really kind and understanding, i felt comfortable instantly. I only did a short intensive course but It was great, so helpful and informative. Found my issues, fixed them and passed straight after. Definitely recommend Coach Carter!!!!',
 '44 weeks ago', '2025-05-18'),

('leah_kennedy_2025-04-06', 'Leah Kennedy', 5,
 'I had such a positive experience learning to drive with Fraser. I reached out to him for a few refresher lessons before my test and I feel he really made the difference and helped me pass! He goes beyond instructing and really helps you to learn techniques and tips for driving that stick with you, as well as being a calming presence on the road. I couldn''t recommend him enough!',
 '51 weeks ago', '2025-04-06'),

('remi_gooding_2025-01-20', 'Remi Gooding', 5,
 'Fraser is a great, relaxed and sufficient driving instructor. He''s laid back and is able to adapt to any of his clients. He helped me from my first lesson to passing my driving test. Big up Coach Carter!',
 '20 Jan 2025', '2025-01-20'),

('le_quan_2024-12-16', 'Lé Quan', 5,
 'A great driving instructor, who has the knowledge to clearly give instructions and corrections with patience, along with positive feedback and reassurance. Coach Carter knows how to create a perfect learning environment for his students to pass. Thank you!',
 '16 Dec 2024', '2024-12-16'),

('tallulah_gregory_2024-12-12', 'Tallulah Gregory', 5,
 'Amazing instructor. So patient, understanding and explains in excellent detail, also alters his teaching depending on how you learn. Would recommend to anyone and everyone!',
 '12 Dec 2024', '2024-12-12'),

('rhiannon_weaver_2024-01-26', 'Rhiannon Weaver', 5,
 'Fraser is a patient and enthusiastic teacher, I had a lot of fun learning to drive with him. He really adapted to my method of learning and prepared me for driving on the road as opposed to just passing the test. I would highly recommend him as your driving instructor.',
 '26 Jan 2024', '2024-01-26'),

('oliver_clark_2024-01-23', 'Oliver Clark', 5,
 'Learning to drive with Fraser was a really enjoyable experience. From our first lesson together he created a calming atmosphere which played a massive part in helping me feel comfortable and confident driving a car! I would highly recommend Carter''s coaching to anyone who wants to learn to drive.',
 '23 Jan 2024', '2024-01-23'),

('james_rutland_2024-01-19', 'James Rutland', 5,
 'If you are looking for an instructor I highly recommend Fraser! He teaches at the perfect pace and explains everything so clearly. No matter how the lesson is going Fraser always keeps the car environment calm and positive; it is genuinely a great environment to learn in. Fraser was the only instructor I had and I passed first time :)',
 '19 Jan 2024', '2024-01-19'),

('joel_bishop_2023-05-15', 'Joel Bishop', 5,
 'Very good teaching style, helps you feel comfortable in the car and on the road and is very supportive and understanding of when and where improvement is needed. Very knowledgeable in how to correct mistakes and errors when driving to prevent learners from doing them again. Helped me get to grips with driving again after 2 years of not being behind the wheel and was very patient and instructive in getting me to feel comfortable controlling the vehicle. Would highly recommend.',
 '15 May 2023', '2023-05-15');

INSERT INTO google_reviews_meta (id, last_fetched_at, place_id, place_name, overall_rating, total_reviews)
VALUES (1, NOW(), 'manual', 'Coach Carter UK', 5.0, 13)
ON CONFLICT (id) DO UPDATE SET
  last_fetched_at = NOW(),
  place_name = EXCLUDED.place_name,
  overall_rating = EXCLUDED.overall_rating,
  total_reviews = EXCLUDED.total_reviews;
