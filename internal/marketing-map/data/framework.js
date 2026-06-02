window.MARKETING_FRAMEWORK = {
  title: "Growth Map",
  version: 2,
  statuses: [
    { id: "not-started", label: "Not started" },
    { id: "in-progress", label: "In progress" },
    { id: "implemented", label: "Implemented" },
    { id: "needs-measurement", label: "Needs measurement" }
  ],
  areas: [
    {
      id: "audience-problem",
      title: "Audience & Problem",
      summary: "Clarify who CoachCarter is trying to attract, what painful problem they have, and why they should care before they are ready to book.",
      bookRefs: ["Get Understanding", "Figure out the problem and who to solve it for", "Engaged leads"],
      prompts: [
        "Who is the most valuable learner segment for CoachCarter right now?",
        "What problem do they feel before they search for a driving instructor?",
        "What would make a learner feel understood before they book?",
        "What should CoachCarter avoid trying to serve for now?"
      ],
      concepts: [
        {
          id: "engaged-leads",
          title: "Engaged leads",
          summary: "The real output is not traffic or attention. It is people who show interest, understand the value, and are willing to be contacted.",
          prompts: [
            "What counts as an engaged lead for CoachCarter?",
            "Which current site actions show genuine learner intent?"
          ],
          ideas: [
            { id: "define-lead-stages", title: "Define learner lead stages", type: "Measurement", tags: ["analytics", "crm"], checklist: ["List current lead sources", "Define engaged lead events", "Choose where to store source/status"] },
            { id: "learner-intent-events", title: "Track high-intent website events", type: "Website/product", tags: ["analytics"], checklist: ["Identify booking intent events", "Add source labels", "Review event data weekly"] }
          ]
        },
        {
          id: "specific-who",
          title: "Specific who",
          summary: "Narrow the audience enough that offers, messages, and examples feel personally relevant rather than generic.",
          prompts: [
            "Which learner type would benefit most from CoachCarter today?",
            "What location, age, anxiety, timing, or test-pressure details matter?"
          ],
          ideas: [
            { id: "learner-segment-notes", title: "Create learner segment notes", type: "Manual process", tags: ["positioning"], checklist: ["Pick 3 priority learner types", "Write their pains", "Write their desired outcome"] },
            { id: "area-specific-positioning", title: "Map messages by local area", type: "Content", tags: ["local"], checklist: ["Choose first local area", "Write local learner concerns", "Connect to area landing page ideas"] }
          ]
        },
        {
          id: "problem-before-offer",
          title: "Problem before offer",
          summary: "Before building a marketing asset, name the exact problem it solves and the friction it removes.",
          prompts: [
            "What learner friction can the website remove before booking?",
            "Where do learners hesitate, delay, or ask the same question?"
          ],
          ideas: [
            { id: "prebooking-friction-list", title: "List pre-booking friction points", type: "Website/product", tags: ["research"], checklist: ["Review learner questions", "Group by theme", "Pick top friction to solve"] }
          ]
        }
      ]
    },
    {
      id: "lead-magnets",
      title: "Lead Magnets",
      summary: "Create useful free things that turn strangers into engaged leads by solving a small but meaningful learner problem.",
      bookRefs: ["Offers and lead magnets", "Make it easy to consume", "Make it easy to ask for more"],
      prompts: [
        "What could CoachCarter give a learner before they book that is genuinely useful?",
        "Could the useful thing be a calculator, checklist, quiz, guide, or availability check?",
        "What would be valuable enough for a learner to exchange an email or phone number?",
        "How does the lead magnet naturally lead to booking a lesson?"
      ],
      concepts: [
        {
          id: "lead-magnet-value",
          title: "Small useful outcome",
          summary: "A lead magnet should solve one small problem quickly, not try to be the whole service.",
          prompts: [
            "What one outcome could a learner get in under five minutes?",
            "What asset would reduce uncertainty about learning to drive?"
          ],
          ideas: [
            { id: "lesson-cost-calculator", title: "Driving lesson cost calculator", type: "Website/product", tags: ["calculator", "capture"], checklist: ["Define calculator inputs", "Design result screen", "Add booking CTA"] },
            { id: "first-lesson-checklist", title: "First lesson prep checklist", type: "Content", tags: ["guide", "learner anxiety"], checklist: ["Draft checklist sections", "Add email capture", "Connect to first booking flow"] },
            { id: "test-readiness-quiz", title: "Driving test readiness quiz", type: "Website/product", tags: ["quiz"], checklist: ["Write readiness questions", "Create score bands", "Suggest next lesson action"] }
          ]
        },
        {
          id: "naming-test",
          title: "Name and message test",
          summary: "Different names and headlines change whether people care. Test plain, specific names before overbuilding.",
          prompts: [
            "What are three names for the same lead magnet?",
            "Which headline says the learner outcome most clearly?"
          ],
          ideas: [
            { id: "lead-magnet-name-bank", title: "Create lead magnet name bank", type: "Content", tags: ["copy"], checklist: ["Write 10 names", "Pick 3 to test", "Record winner"] }
          ]
        },
        {
          id: "easy-consumption",
          title: "Easy to consume",
          summary: "The free thing should be fast, clear, and low friction so learners actually use it.",
          prompts: [
            "Can this be consumed without an account?",
            "What can be removed from the first step?"
          ],
          ideas: [
            { id: "no-account-lead-tool", title: "No-account lead tool flow", type: "Website/product", tags: ["ux"], checklist: ["Sketch minimal flow", "Identify required fields", "Add optional capture step"] }
          ]
        }
      ]
    },
    {
      id: "cta-capture",
      title: "Website CTAs & Capture",
      summary: "Turn interest into permission to contact, booking intent, or a next step that CoachCarter can follow up on.",
      bookRefs: ["Call to action", "Get permission to contact", "Make it easy to tell you they want more"],
      prompts: [
        "Where does CoachCarter currently ask learners to take action?",
        "Which pages need a clearer next step?",
        "What information is essential at capture, and what can wait?",
        "What happens immediately after a learner gives contact details?"
      ],
      concepts: [
        {
          id: "clear-cta",
          title: "Clear next action",
          summary: "Every marketing asset should tell the learner what to do next and make that next step obvious.",
          prompts: [
            "What is the primary action for each major page?",
            "Where are CTAs vague or competing?"
          ],
          ideas: [
            { id: "cta-inventory", title: "Inventory current website CTAs", type: "Website/product", tags: ["audit"], checklist: ["List main pages", "Record primary CTA", "Flag weak or competing CTAs"] },
            { id: "lead-magnet-cta-pattern", title: "Reusable lead magnet CTA pattern", type: "Website/product", tags: ["component"], checklist: ["Define CTA copy", "Define capture fields", "Add confirmation state"] }
          ]
        },
        {
          id: "permission-to-contact",
          title: "Permission to contact",
          summary: "Capture should create a legitimate follow-up path, not just collect a detail with no next move.",
          prompts: [
            "What follow-up is a learner expecting after each capture point?",
            "Which contact method feels natural for driving lesson enquiries?"
          ],
          ideas: [
            { id: "capture-followup-map", title: "Map capture point to follow-up", type: "Email/SMS follow-up", tags: ["automation"], checklist: ["List capture points", "Define expected follow-up", "Write first message"] }
          ]
        },
        {
          id: "booking-bridge",
          title: "Bridge to booking",
          summary: "The capture path should reduce the distance between useful content and an actual lesson booking.",
          prompts: [
            "What is the shortest ethical path from lead magnet to lesson booking?",
            "What booking friction appears after capture?"
          ],
          ideas: [
            { id: "result-to-booking-flow", title: "Lead magnet result to booking flow", type: "Website/product", tags: ["conversion"], checklist: ["Pick one lead magnet", "Design result CTA", "Measure booking clicks"] }
          ]
        }
      ]
    },
    {
      id: "warm-outreach",
      title: "Warm Outreach",
      summary: "Use existing relationships and known contacts before relying on colder or more expensive channels.",
      bookRefs: ["Warm outreach", "Personalize greeting", "Ask for reviews, feedback, or support"],
      prompts: [
        "Who already knows CoachCarter or you personally?",
        "What warm audience can help with feedback, reviews, referrals, or introductions?",
        "What would a low-pressure ask look like?",
        "How could warm outreach produce website or product improvements?"
      ],
      concepts: [
        {
          id: "known-network",
          title: "Known network",
          summary: "Start with people who already have context or goodwill because response rates and learning speed are higher.",
          prompts: [
            "Who can give honest feedback on CoachCarter's learner journey?",
            "Who can introduce driving instructors or learners?"
          ],
          ideas: [
            { id: "warm-feedback-list", title: "Warm feedback list", type: "Outreach", tags: ["feedback"], checklist: ["List 25 warm contacts", "Write feedback ask", "Record responses"] },
            { id: "instructor-intro-ask", title: "Instructor introduction ask", type: "Outreach", tags: ["supply"], checklist: ["Write short intro request", "Send to warm contacts", "Track introductions"] }
          ]
        },
        {
          id: "warm-ask-types",
          title: "Ask types",
          summary: "Warm outreach can ask for advice, reviews, referrals, testimonials, intros, or testing help depending on the relationship.",
          prompts: [
            "Which ask would feel natural for each contact type?",
            "What is the smallest useful ask?"
          ],
          ideas: [
            { id: "ask-template-bank", title: "Warm outreach ask templates", type: "Outreach", tags: ["templates"], checklist: ["Write feedback template", "Write intro template", "Write referral template"] }
          ]
        }
      ]
    },
    {
      id: "free-content",
      title: "Free Content",
      summary: "Create useful public content that earns attention, teaches, builds trust, and points people to the next step.",
      bookRefs: ["Post free content", "Content unit", "Retain", "Reward", "Ask"],
      prompts: [
        "What learner questions could CoachCarter answer better than a generic article?",
        "What content would make learners trust the platform before booking?",
        "Which content formats fit a driving school SaaS founder realistically?",
        "Where should content ask the learner to take the next step?"
      ],
      concepts: [
        {
          id: "content-unit",
          title: "Content unit",
          summary: "A useful piece of content should attract the right person, keep them engaged, reward them with value, and ask for a next step.",
          prompts: [
            "What recurring content template could CoachCarter use?",
            "What is the CTA for educational content?"
          ],
          ideas: [
            { id: "learner-question-library", title: "Learner question content library", type: "Content", tags: ["seo", "education"], checklist: ["List 30 learner questions", "Group by theme", "Pick first 5 posts"] },
            { id: "area-driving-guides", title: "Local driving lesson guides", type: "Content", tags: ["local", "seo"], checklist: ["Pick first local area", "Outline guide", "Add instructor/booking CTA"] }
          ]
        },
        {
          id: "ask-from-content",
          title: "Ask from content",
          summary: "Content should include a next action when the learner is ready, rather than hoping they figure it out.",
          prompts: [
            "Which content should point to a lead magnet?",
            "Which content should point directly to booking?"
          ],
          ideas: [
            { id: "content-cta-map", title: "Map content topics to CTAs", type: "Content", tags: ["conversion"], checklist: ["Pick 10 topics", "Assign CTA", "Add tracking source"] }
          ]
        },
        {
          id: "content-cadence",
          title: "Sustainable cadence",
          summary: "Content needs a repeatable rhythm that is realistic enough to keep going.",
          prompts: [
            "What cadence could you sustain without burning out?",
            "Which topics can become reusable templates?"
          ],
          ideas: [
            { id: "weekly-content-template", title: "Weekly content template", type: "Manual process", tags: ["cadence"], checklist: ["Choose format", "Create topic backlog", "Schedule first 4 pieces"] }
          ]
        }
      ]
    },
    {
      id: "cold-outreach",
      title: "Cold Outreach",
      summary: "Reach strangers with personalized value, enough volume, and follow-up when warm channels are not enough.",
      bookRefs: ["Cold outreach", "Get a way to contact them", "Personalize, then give big fast value", "Volume", "Follow up"],
      prompts: [
        "Which strangers would be worth contacting for CoachCarter?",
        "What big fast value could you offer before asking for anything?",
        "What cold outreach should be avoided because it would feel spammy?",
        "Where could outreach create partnerships, instructor supply, or learner demand?"
      ],
      concepts: [
        {
          id: "target-list",
          title: "Target list",
          summary: "Cold outreach starts with a clear list of people or organizations worth contacting.",
          prompts: [
            "Who would be valuable to reach but does not already know CoachCarter?",
            "What data would make the list specific and relevant?"
          ],
          ideas: [
            { id: "local-organization-list", title: "Local organization outreach list", type: "Outreach", tags: ["partners"], checklist: ["List local colleges/employers", "Find contact route", "Write value-first message"] },
            { id: "instructor-prospect-list", title: "Instructor prospect list", type: "Outreach", tags: ["supply"], checklist: ["Define ideal instructor", "Build first list", "Track responses"] }
          ]
        },
        {
          id: "value-first-message",
          title: "Value-first message",
          summary: "Cold messages should quickly show relevance and offer value before asking for attention.",
          prompts: [
            "What can CoachCarter give a cold prospect that is useful immediately?",
            "How can messages be personalized without taking too long?"
          ],
          ideas: [
            { id: "cold-message-templates", title: "Cold message templates", type: "Outreach", tags: ["templates"], checklist: ["Write instructor version", "Write partner version", "Write follow-up version"] }
          ]
        },
        {
          id: "follow-up-system",
          title: "Follow-up system",
          summary: "Cold outreach works through repeated, respectful attempts across time rather than a single message.",
          prompts: [
            "How many follow-ups feel appropriate for each outreach type?",
            "What should change between follow-ups?"
          ],
          ideas: [
            { id: "outreach-followup-sequence", title: "Simple outreach follow-up sequence", type: "Manual process", tags: ["follow-up"], checklist: ["Define sequence length", "Write message variants", "Set tracking sheet"] }
          ]
        }
      ]
    },
    {
      id: "paid-ads",
      title: "Paid Ads",
      summary: "Use paid channels only when the offer, capture, follow-up, and measurement are clear enough to avoid flying blind.",
      bookRefs: ["Run paid ads", "Call out + value + CTA", "Get permission", "Track money", "Efficiency benchmarks"],
      prompts: [
        "What would CoachCarter advertise before it has a proven lead magnet?",
        "Which audience and platform are specific enough to test?",
        "What would make a paid ad test safe and measurable?",
        "What result would justify continuing or stopping?"
      ],
      concepts: [
        {
          id: "ad-readiness",
          title: "Ad readiness",
          summary: "Paid ads need a clear target, offer, capture path, and follow-up before spend is useful.",
          prompts: [
            "Which lead magnet or booking path is ready enough to send paid traffic to?",
            "What measurement must exist before spending?"
          ],
          ideas: [
            { id: "paid-ads-readiness-checklist", title: "Paid ads readiness checklist", type: "Paid ads", tags: ["measurement"], checklist: ["Pick offer", "Confirm capture path", "Confirm source tracking", "Set stop rule"] }
          ]
        },
        {
          id: "ad-message",
          title: "Call out, value, CTA",
          summary: "Ads should name the audience, give a clear reason to care, and tell the person what to do next.",
          prompts: [
            "Who should the ad call out?",
            "What value does the ad promise without overclaiming?"
          ],
          ideas: [
            { id: "ad-copy-bank", title: "Ad copy bank", type: "Paid ads", tags: ["copy"], checklist: ["Write 5 call-outs", "Write 5 value lines", "Write 3 CTAs"] }
          ]
        },
        {
          id: "track-money",
          title: "Track money",
          summary: "Ad spend should connect to leads, bookings, and value so decisions are not based on vibes.",
          prompts: [
            "What is the minimum metric chain from spend to booking?",
            "What cost per booking would be acceptable?"
          ],
          ideas: [
            { id: "ad-economics-sheet", title: "Paid acquisition economics sheet", type: "Measurement", tags: ["finance"], checklist: ["Define CPL", "Define CPB", "Estimate booking value", "Set acceptable ranges"] }
          ]
        }
      ]
    },
    {
      id: "referrals",
      title: "Referrals",
      summary: "Turn happy learners, instructors, and schools into a repeatable source of new leads by making the ask timely and easy.",
      bookRefs: ["Customer referrals", "Word of mouth", "Give more value", "Ask for referrals"],
      prompts: [
        "When is a learner most likely to recommend their instructor or CoachCarter?",
        "What referral ask would feel helpful rather than pushy?",
        "What reward, if any, fits driving lessons and UK expectations?",
        "What can the product automate at the exact right moment?"
      ],
      concepts: [
        {
          id: "referral-moment",
          title: "Right moment",
          summary: "The ask should happen after value is felt, not randomly.",
          prompts: [
            "Which lesson milestones create delight or confidence?",
            "Which events already exist in the booking lifecycle?"
          ],
          ideas: [
            { id: "lesson-milestone-referral", title: "Referral ask after lesson milestone", type: "Referral", tags: ["automation"], checklist: ["Choose milestone", "Write ask", "Decide delivery channel"] },
            { id: "test-pass-referral", title: "Test pass referral moment", type: "Referral", tags: ["celebration"], checklist: ["Identify pass event source", "Write congratulation message", "Add referral CTA"] }
          ]
        },
        {
          id: "easy-referral",
          title: "Easy to refer",
          summary: "Referrals should require almost no effort: a link, message, or clear next step.",
          prompts: [
            "What is the easiest thing a learner could share?",
            "What referral page or code would make tracking possible?"
          ],
          ideas: [
            { id: "shareable-referral-link", title: "Shareable learner referral link", type: "Website/product", tags: ["tracking"], checklist: ["Design referral URL", "Define tracking data", "Create share copy"] },
            { id: "referral-message-copy", title: "Prewritten referral message copy", type: "Referral", tags: ["templates"], checklist: ["Write SMS version", "Write WhatsApp version", "Write email version"] }
          ]
        },
        {
          id: "give-more-value",
          title: "Give more value",
          summary: "Referral volume improves when the underlying experience and perceived result are stronger.",
          prompts: [
            "What could CoachCarter improve that would naturally create more recommendations?",
            "What progress or result can learners see clearly?"
          ],
          ideas: [
            { id: "learner-progress-proof", title: "Learner progress proof moments", type: "Website/product", tags: ["retention", "referral"], checklist: ["Identify progress moments", "Sketch progress summary", "Connect referral ask"] }
          ]
        }
      ]
    },
    {
      id: "lead-getters",
      title: "Partners & Lead Getters",
      summary: "Use leverage by enabling other people and organizations to bring CoachCarter leads, not just direct marketing effort.",
      bookRefs: ["Get lead getters", "Employees", "Agencies", "Affiliates and partners", "Leverage"],
      prompts: [
        "Who could benefit from sending learners or instructors to CoachCarter?",
        "Which instructors, partners, or organizations could become lead getters?",
        "What offer would make the relationship worth it for them?",
        "What would need to exist to track and reward their contribution?"
      ],
      concepts: [
        {
          id: "instructor-lead-getters",
          title: "Instructors as lead getters",
          summary: "People already connected to the platform can help bring leads if the ask, incentive, and process are clear.",
          prompts: [
            "How could instructors benefit from helping CoachCarter grow?",
            "What assets would make it easy for instructors to share?"
          ],
          ideas: [
            { id: "instructor-share-kit", title: "Instructor share kit", type: "Referral", tags: ["instructors"], checklist: ["Write share copy", "Create simple landing link", "Track source"] },
            { id: "instructor-referral-program", title: "Instructor referral program sketch", type: "Partnership", tags: ["incentives"], checklist: ["Define eligible referrals", "Define reward", "Define tracking"] }
          ]
        },
        {
          id: "local-partners",
          title: "Local partners",
          summary: "Organizations near learners can become referral partners if the value exchange is obvious.",
          prompts: [
            "Which local organizations meet learners before they need lessons?",
            "What would make CoachCarter useful to that organization?"
          ],
          ideas: [
            { id: "college-partner-pack", title: "College partner pack", type: "Partnership", tags: ["local"], checklist: ["Pick target college", "Write partner value", "Create learner link"] },
            { id: "employer-new-driver-guide", title: "Employer new driver guide", type: "Partnership", tags: ["employers"], checklist: ["Define employer angle", "Write guide outline", "Add lead capture"] }
          ]
        },
        {
          id: "agency-use",
          title: "Agency use",
          summary: "Agencies can help with execution, but only when the outcome, measurement, and evaluation criteria are clear.",
          prompts: [
            "What would you outsource only after the system is clear?",
            "How would you judge whether an agency is useful?"
          ],
          ideas: [
            { id: "agency-brief-template", title: "Agency brief template", type: "Manual process", tags: ["outsourcing"], checklist: ["Define objective", "Define metrics", "Define assets provided"] }
          ]
        }
      ]
    },
    {
      id: "measurement",
      title: "Measurement",
      summary: "Make marketing observable enough to choose what to do more of, improve, or stop.",
      bookRefs: ["Benchmarks", "How well am I doing", "Cost and returns", "Track money"],
      prompts: [
        "What numbers would tell you the lead system is working?",
        "Which metrics can CoachCarter already see?",
        "Which metrics need product or tracking changes?",
        "What weekly review would be simple enough to keep doing?"
      ],
      concepts: [
        {
          id: "lead-metrics",
          title: "Lead metrics",
          summary: "Track the path from attention to engaged lead to booking so weak points become visible.",
          prompts: [
            "What is the minimum dashboard that would guide marketing decisions?",
            "Where do leads currently disappear?"
          ],
          ideas: [
            { id: "marketing-metrics-dashboard", title: "Private marketing metrics dashboard", type: "Measurement", tags: ["dashboard"], checklist: ["List required metrics", "Identify data sources", "Build first manual version"] },
            { id: "lead-source-field", title: "Lead source tracking field", type: "Website/product", tags: ["analytics"], checklist: ["Define source taxonomy", "Capture source on forms", "Surface in admin/private report"] }
          ]
        },
        {
          id: "experiment-log",
          title: "Experiment log",
          summary: "Record what was tried, why, and what happened so marketing compounds instead of resetting.",
          prompts: [
            "What does a lightweight experiment record need?",
            "How often should you review experiments?"
          ],
          ideas: [
            { id: "marketing-experiment-log", title: "Marketing experiment log", type: "Manual process", tags: ["learning"], checklist: ["Create log format", "Add first experiment", "Schedule review"] }
          ]
        }
      ]
    },
    {
      id: "more-better-new",
      title: "More Better New",
      summary: "Improve the system by doing more of what works, making weak areas better, and testing new angles without losing the core.",
      bookRefs: ["Core Four on steroids", "More", "Better", "New"],
      prompts: [
        "Which channel deserves more volume?",
        "Which existing asset should be improved before adding anything new?",
        "What new channel or angle is worth a small test?",
        "What should be stopped or ignored?"
      ],
      concepts: [
        {
          id: "more",
          title: "More",
          summary: "Increase volume on channels or assets that already show promise.",
          prompts: [
            "What is working enough to do more of?",
            "What bottleneck prevents more volume?"
          ],
          ideas: [
            { id: "double-down-list", title: "Double-down list", type: "Manual process", tags: ["prioritization"], checklist: ["Identify working signals", "Pick one to increase", "Define next volume step"] }
          ]
        },
        {
          id: "better",
          title: "Better",
          summary: "Improve targeting, message, offer, CTA, follow-up, or delivery before jumping to a new channel.",
          prompts: [
            "Which weak piece hurts the whole funnel?",
            "What one improvement could lift several channels?"
          ],
          ideas: [
            { id: "funnel-weak-point-review", title: "Funnel weak point review", type: "Measurement", tags: ["conversion"], checklist: ["Map funnel", "Find lowest-confidence step", "Choose improvement"] }
          ]
        },
        {
          id: "new",
          title: "New",
          summary: "Test new angles, audiences, channels, or offers in small experiments.",
          prompts: [
            "What new idea is worth a tiny test?",
            "How can the test be small enough to learn quickly?"
          ],
          ideas: [
            { id: "new-test-backlog", title: "New marketing test backlog", type: "Manual process", tags: ["experiments"], checklist: ["List new ideas", "Pick smallest test", "Define success signal"] }
          ]
        }
      ]
    },
    {
      id: "money-model",
      title: "Money Model",
      summary: "Design the sequence of offers that turns leads into customers, customers into more cash, and useful relationships into recurring value.",
      bookRefs: ["$100M Money Model", "What you offer", "When you offer", "How you offer it", "Increase customers and speed of payment"],
      prompts: [
        "What is CoachCarter's current sequence of offers from stranger to paying customer?",
        "Where does the current journey create cash quickly, and where does it delay cash?",
        "Which offer exists only in your head but not yet in the product or site?",
        "What would make the model simple enough to scale without constant founder intervention?"
      ],
      concepts: [
        {
          id: "offer-sequence",
          title: "Sequence of offers",
          summary: "The money model is the ordered path of what is offered, when it is offered, and how it is presented.",
          prompts: [
            "What does a learner see first, second, third, and after booking?",
            "What does an instructor see first, second, third, and after joining?",
            "Where is the next offer missing or unclear?"
          ],
          ideas: [
            { id: "learner-offer-path-map", title: "Map learner offer path", type: "Manual process", tags: ["offers", "journey"], checklist: ["List current learner entry points", "Write first offer", "Write next offer", "Identify missing follow-up"] },
            { id: "instructor-offer-path-map", title: "Map instructor offer path", type: "Manual process", tags: ["offers", "supply"], checklist: ["List current instructor entry points", "Write first offer", "Write next offer", "Identify retention offer"] }
          ]
        },
        {
          id: "cash-speed",
          title: "Customers and speed of payment",
          summary: "A stronger model gets more customers and pulls useful cash forward rather than waiting for slow drip economics.",
          prompts: [
            "Where can CoachCarter ethically reduce time from interest to payment?",
            "Which offers could cover acquisition and service cost faster?",
            "Which current paths create value but delay cash too long?"
          ],
          ideas: [
            { id: "speed-to-payment-audit", title: "Speed-to-payment audit", type: "Measurement", tags: ["cash", "conversion"], checklist: ["Map interest-to-payment steps", "Find delays", "Pick one payment-speed improvement"] },
            { id: "first-30-day-cash-model", title: "First 30-day cash model", type: "Measurement", tags: ["finance"], checklist: ["Estimate acquisition cost", "Estimate service cost", "Estimate 30-day profit", "Set minimum viable margin"] }
          ]
        },
        {
          id: "bad-money-model-warning",
          title: "Bad money model warning",
          summary: "A model that loses money to acquire customers or recovers profit too slowly can starve growth even when demand exists.",
          prompts: [
            "Where could CoachCarter accidentally buy growth too expensively?",
            "Which offers look attractive but might create delayed or weak cashflow?",
            "What must be true before paid acquisition can scale?"
          ],
          ideas: [
            { id: "cash-risk-checklist", title: "Cash risk checklist", type: "Measurement", tags: ["risk", "ads"], checklist: ["Define max cost per booking", "Define refund/cancellation exposure", "Define payback period", "Review before ads"] }
          ]
        }
      ]
    },
    {
      id: "attraction-offers",
      title: "Attraction Offers",
      summary: "Offers designed to turn strangers into first-time customers and solve the first cash constraint.",
      bookRefs: ["Stage I: Get Cash", "Attraction offers", "Win your money back", "Giveaways", "Decoy offer", "Buy X Get Y Free", "Pay less now or pay more later"],
      prompts: [
        "What first offer would make a learner say yes faster?",
        "What first offer would be simple enough to explain in one line?",
        "What would make a first booking feel lower risk without creating messy refund exposure?",
        "Which attraction offer could CoachCarter test without changing the whole business?"
      ],
      concepts: [
        {
          id: "stage-one-get-cash",
          title: "Stage I: Get Cash",
          summary: "Perfect one attraction offer first so customer acquisition and basic cost coverage become reliable.",
          prompts: [
            "What is the one first offer CoachCarter should perfect before adding layers?",
            "What does perfect mean: more bookings, faster payment, better instructor supply, or lower support?"
          ],
          ideas: [
            { id: "first-booking-attraction-offer", title: "First-booking attraction offer", type: "Website/product", tags: ["offer", "booking"], checklist: ["Choose learner segment", "Write offer promise", "Define first booking CTA", "Measure conversion"] },
            { id: "instructor-first-supply-offer", title: "Instructor first-supply offer", type: "Website/product", tags: ["instructors", "offer"], checklist: ["Define instructor pain", "Write joining offer", "Choose proof point", "Measure enquiries"] }
          ]
        },
        {
          id: "win-your-money-back",
          title: "Win your money back",
          summary: "A goal-based refund or credit can reduce perceived risk, but criteria must be trackable and financially safe.",
          prompts: [
            "What learner result or action could be tracked cleanly?",
            "Would the reward be cash, lesson credit, or something else?",
            "What refund or credit rules would avoid confusion and abuse?"
          ],
          ideas: [
            { id: "goal-based-credit-offer", title: "Goal-based lesson credit offer", type: "Website/product", tags: ["credits", "risk"], checklist: ["Pick trackable action/result", "Model credit exposure", "Write clear terms", "Check refund/accounting implications"] }
          ]
        },
        {
          id: "giveaway-offer",
          title: "Giveaway with promotional offer",
          summary: "Advertise a prize, collect eligible leads, and give non-winners a promotional path into the core offer.",
          prompts: [
            "What giveaway would attract the right learner rather than random entrants?",
            "What promotional offer should non-winners receive?",
            "What data should be captured without overcomplicating entry?"
          ],
          ideas: [
            { id: "free-lesson-giveaway", title: "Free lesson giveaway funnel", type: "Website/product", tags: ["lead capture", "promotion"], checklist: ["Define prize", "Define eligibility", "Create non-winner offer", "Add source tracking"] }
          ]
        },
        {
          id: "decoy-and-contrast",
          title: "Decoy and contrast",
          summary: "A lesser option can make the premium or core option look obviously more valuable when the contrast is large.",
          prompts: [
            "What cheap or free lesser version could clarify the value of booking properly?",
            "What premium option should sit beside it?",
            "Would this help or confuse learners?"
          ],
          ideas: [
            { id: "lesson-readiness-decoy", title: "Free readiness check vs paid lesson contrast", type: "Website/product", tags: ["offer", "contrast"], checklist: ["Define free check", "Define premium next step", "Write comparison copy", "Measure booking clicks"] }
          ]
        },
        {
          id: "pay-now-pay-later",
          title: "Pay less now or pay more later",
          summary: "A time-sensitive choice can pull payment forward by making the earlier commitment clearly better.",
          prompts: [
            "Where could early commitment be rewarded without harming instructor economics?",
            "What bonus could make paying now feel better than waiting?",
            "What terms must be clear for cancellation and credits?"
          ],
          ideas: [
            { id: "early-block-booking-bonus", title: "Early block-booking bonus", type: "Website/product", tags: ["credits", "offer"], checklist: ["Define block size", "Define bonus", "Model instructor/school economics", "Write terms"] }
          ]
        }
      ]
    },
    {
      id: "upsell-offers",
      title: "Upsell Offers",
      summary: "Offers that solve the next immediate problem and raise 30-day profit after the customer says yes.",
      bookRefs: ["Stage II: Get More Cash", "Upsell offers", "Menu upsell", "Anchor upsell", "Rollover upsell", "Card on file"],
      prompts: [
        "After a learner books or buys credit, what next problem appears immediately?",
        "What add-on would genuinely improve the outcome rather than feel tacked on?",
        "What premium anchor would make the main offer clearer?",
        "Could previous spend or credit roll into a better package?"
      ],
      concepts: [
        {
          id: "classic-upsell",
          title: "Classic next-problem upsell",
          summary: "Offer the solution to the next immediate problem created by the first purchase.",
          prompts: [
            "What does a learner need right after a first lesson booking?",
            "What does an instructor need right after joining?"
          ],
          ideas: [
            { id: "first-lesson-to-block-upsell", title: "First lesson to block-booking upsell", type: "Website/product", tags: ["credits", "conversion"], checklist: ["Define trigger moment", "Write upgrade copy", "Show value difference", "Measure upgrade rate"] },
            { id: "test-prep-upsell", title: "Test prep add-on upsell", type: "Website/product", tags: ["learner outcome"], checklist: ["Define add-on", "Find trigger point", "Write benefits", "Measure take-up"] }
          ]
        },
        {
          id: "menu-upsell",
          title: "Menu upsell",
          summary: "Show a small menu of relevant upgrades, including what the learner does not need, so the recommendation feels trustworthy.",
          prompts: [
            "What upgrade menu could be helpful rather than pushy?",
            "Where can CoachCarter say 'you probably do not need this yet'?"
          ],
          ideas: [
            { id: "recommended-lesson-package-menu", title: "Recommended lesson package menu", type: "Website/product", tags: ["packages"], checklist: ["Define package options", "Add guidance copy", "Highlight recommended option", "Avoid overwhelming choices"] }
          ]
        },
        {
          id: "anchor-upsell",
          title: "Anchor upsell",
          summary: "Present a premium high-value option first so the main offer is easier to understand and compare.",
          prompts: [
            "What would a premium CoachCarter learner package include?",
            "Would an anchor package clarify value or feel unrealistic?"
          ],
          ideas: [
            { id: "premium-learner-package-anchor", title: "Premium learner package anchor", type: "Website/product", tags: ["pricing", "packages"], checklist: ["Define premium package", "Define main package", "Write comparison copy", "Measure package selection"] }
          ]
        },
        {
          id: "rollover-upsell",
          title: "Rollover upsell",
          summary: "Credit a previous purchase toward a larger offer to re-engage or upgrade the customer without wasting prior spend.",
          prompts: [
            "Where could unused lesson credit become an upgrade path?",
            "Could a refund or cancelled booking credit roll into a package?"
          ],
          ideas: [
            { id: "credit-to-package-rollover", title: "Credit to package rollover", type: "Website/product", tags: ["credits", "retention"], checklist: ["Define eligible credit", "Model accounting impact", "Write upgrade rule", "Track conversions"] }
          ]
        }
      ]
    },
    {
      id: "downsell-offers",
      title: "Downsell Offers",
      summary: "Alternative ways to say yes when the main offer is rejected, without discounting the same product for less.",
      bookRefs: ["Stage II: Get More Cash", "Downsell offers", "Payment plan downsells", "Trial with penalty", "Feature downsells"],
      prompts: [
        "When a learner or instructor says no, what are they really objecting to?",
        "Could the offer change by payment terms, features, or delivery rather than just lower price?",
        "What lower-barrier version would still preserve the value of the original offer?",
        "What downsell would be safe, clear, and easy to administer?"
      ],
      concepts: [
        {
          id: "payment-plan-downsell",
          title: "Payment plan downsell",
          summary: "Spread cost over time to lower the barrier while preserving incentives for paying in full.",
          prompts: [
            "Which CoachCarter offers are blocked by upfront cost?",
            "How would paying in full still remain attractive?"
          ],
          ideas: [
            { id: "credit-package-payment-plan", title: "Credit package payment plan", type: "Website/product", tags: ["payments", "credits"], checklist: ["Choose package", "Model payment timing", "Define paid-in-full incentive", "Check Stripe/accounting flow"] }
          ]
        },
        {
          id: "trial-with-penalty",
          title: "Trial with penalty",
          summary: "A customer can get a trial free if they meet clear action or result terms, with a fee if they do not.",
          prompts: [
            "Is there any CoachCarter context where this is ethical and simple?",
            "What action could be tracked without ambiguity?",
            "Would card-on-file make sense here or create friction?"
          ],
          ideas: [
            { id: "instructor-trial-terms", title: "Instructor trial with clear action terms", type: "Website/product", tags: ["instructors", "trial"], checklist: ["Define trial action", "Define penalty/fee", "Check fairness", "Decide if worth testing"] }
          ]
        },
        {
          id: "feature-downsell",
          title: "Feature downsell",
          summary: "Create a lower version by removing quantity, quality, support, or guarantees, rather than negotiating the same thing cheaper.",
          prompts: [
            "What lesser version of an offer is still useful?",
            "What can be removed without damaging the core experience?",
            "What should never be discounted because it teaches the wrong lesson?"
          ],
          ideas: [
            { id: "lite-package-downsell", title: "Lite package downsell", type: "Website/product", tags: ["packages"], checklist: ["Define full package", "Remove features for lite", "Keep value distinction clear", "Measure conversion"] }
          ]
        }
      ]
    },
    {
      id: "continuity-offers",
      title: "Continuity Offers",
      summary: "Ongoing value for ongoing payment, designed to keep useful relationships buying and increase total customer value.",
      bookRefs: ["Stage III: Get The Most Cash", "Continuity offers", "Continuity bonus", "Continuity discount", "Waived fee offer"],
      prompts: [
        "What ongoing value could CoachCarter provide after the first transaction?",
        "What recurring offer would be genuinely useful rather than forced?",
        "Could continuity apply to learners, instructors, schools, or partners?",
        "What would make a long-term commitment fair and clear?"
      ],
      concepts: [
        {
          id: "ongoing-value",
          title: "Ongoing value",
          summary: "Continuity should solve a recurring problem, not merely charge repeatedly.",
          prompts: [
            "Which CoachCarter user has a recurring problem?",
            "What repeated value could be delivered with low marginal effort?"
          ],
          ideas: [
            { id: "instructor-growth-membership", title: "Instructor growth membership concept", type: "Website/product", tags: ["instructors", "continuity"], checklist: ["Define ongoing value", "Define monthly price hypothesis", "List included tools", "Validate demand manually"] },
            { id: "learner-progress-membership", title: "Learner progress support concept", type: "Website/product", tags: ["learners", "continuity"], checklist: ["Define recurring learner value", "Check if lessons already cover it", "Avoid forced subscription", "Assess usefulness"] }
          ]
        },
        {
          id: "continuity-bonus",
          title: "Continuity bonus",
          summary: "A valuable bonus can make signing up today feel better than buying the bonus alone.",
          prompts: [
            "What bonus would be worth more than the first payment?",
            "Would this bonus help retention or just attract poor-fit customers?"
          ],
          ideas: [
            { id: "continuity-bonus-bank", title: "Continuity bonus bank", type: "Manual process", tags: ["offers"], checklist: ["List possible bonuses", "Estimate standalone value", "Choose one to test"] }
          ]
        },
        {
          id: "continuity-discount",
          title: "Continuity discount",
          summary: "A long-term commitment can earn free time or a spread discount if the economics and cancellation rules are clear.",
          prompts: [
            "Would a long-term commitment make sense for instructors or schools?",
            "Where would free time or setup support be valuable?",
            "What early-exit terms would be fair?"
          ],
          ideas: [
            { id: "annual-instructor-plan", title: "Annual instructor plan sketch", type: "Website/product", tags: ["pricing", "instructors"], checklist: ["Define monthly value", "Define annual incentive", "Define cancellation rules", "Model cash impact"] }
          ]
        },
        {
          id: "waived-fee-offer",
          title: "Waived fee offer",
          summary: "A setup or onboarding fee can be waived in exchange for a longer commitment, but the early exit rule must be explicit.",
          prompts: [
            "Is there a legitimate setup cost CoachCarter could charge or waive?",
            "Would waived setup simplify or complicate the proposition?"
          ],
          ideas: [
            { id: "waived-onboarding-fee-test", title: "Waived onboarding fee test", type: "Website/product", tags: ["pricing", "commitment"], checklist: ["Define setup value", "Define commitment", "Define early-exit rule", "Decide if appropriate"] }
          ]
        }
      ]
    },
    {
      id: "money-model-rules",
      title: "Money Model Rules",
      summary: "Guardrails for building the growth system: perfect one offer at a time, keep it simple, and use partner products to fill gaps where sensible.",
      bookRefs: ["Perfect one offer at a time", "Simple scales, fancy fails", "Affiliate products fill gaps"],
      prompts: [
        "Which offer deserves focus before adding anything else?",
        "Where is the model becoming clever instead of simple?",
        "What gap could be filled by a partner rather than building from scratch?",
        "What should be deliberately ignored for now?"
      ],
      concepts: [
        {
          id: "one-offer-at-a-time",
          title: "Perfect one offer at a time",
          summary: "Do not stack complexity before one offer is clear, working, and measurable.",
          prompts: [
            "What is the current one offer to perfect?",
            "What evidence would show it is working enough to add the next layer?"
          ],
          ideas: [
            { id: "one-offer-focus-board", title: "One-offer focus board", type: "Manual process", tags: ["focus"], checklist: ["Choose current offer", "Define success signal", "Pause competing offer ideas", "Review weekly"] }
          ]
        },
        {
          id: "simple-scales",
          title: "Simple scales, fancy fails",
          summary: "Simple offers, rules, and flows are easier to sell, operate, measure, and automate.",
          prompts: [
            "Which offer has too many conditions?",
            "What would the simpler version be?",
            "Can a learner explain it back in one sentence?"
          ],
          ideas: [
            { id: "offer-simplicity-review", title: "Offer simplicity review", type: "Manual process", tags: ["copy", "ops"], checklist: ["Pick offer", "Write one-sentence version", "Remove one condition", "Check operational burden"] }
          ]
        },
        {
          id: "affiliate-products-fill-gaps",
          title: "Partner products fill gaps",
          summary: "Where CoachCarter cannot or should not build the whole solution, partner or affiliate products may fill the gap.",
          prompts: [
            "What learner or instructor need is outside CoachCarter's core?",
            "Who already solves that need well?",
            "Would a partner offer improve the journey or distract from it?"
          ],
          ideas: [
            { id: "partner-product-gap-list", title: "Partner product gap list", type: "Partnership", tags: ["affiliate", "partners"], checklist: ["List adjacent needs", "Find possible partners", "Define referral value", "Decide first test"] }
          ]
        }
      ]
    }
  ],
  links: [
    ["audience-problem", "lead-magnets", "Audience clarity shapes what is useful"],
    ["lead-magnets", "cta-capture", "Useful asset needs a next step"],
    ["cta-capture", "measurement", "Capture should be measurable"],
    ["free-content", "lead-magnets", "Content can point to magnets"],
    ["warm-outreach", "audience-problem", "Warm feedback sharpens who/problem"],
    ["cold-outreach", "lead-magnets", "Cold value can use magnets"],
    ["paid-ads", "lead-magnets", "Ads need an offer or magnet"],
    ["paid-ads", "cta-capture", "Ads need capture"],
    ["referrals", "lead-getters", "Referral loops create lead getters"],
    ["lead-getters", "measurement", "Partners need tracking"],
    ["measurement", "more-better-new", "Results decide what to improve"],
    ["more-better-new", "free-content", "Improve or expand content"],
    ["more-better-new", "paid-ads", "Scale only with feedback"],
    ["more-better-new", "referrals", "Improve referral loops"],
    ["lead-magnets", "attraction-offers", "Lead magnets can become entry offers"],
    ["cta-capture", "attraction-offers", "Capture turns attention into offer acceptance"],
    ["paid-ads", "money-model", "Paid growth needs offer economics"],
    ["measurement", "money-model", "Money model needs numbers"],
    ["money-model", "attraction-offers", "First offer gets cash"],
    ["attraction-offers", "upsell-offers", "First yes creates next problem"],
    ["upsell-offers", "downsell-offers", "Rejected upgrade needs alternate yes"],
    ["upsell-offers", "continuity-offers", "More value can become recurring"],
    ["downsell-offers", "attraction-offers", "Downsells preserve first customer acquisition"],
    ["continuity-offers", "money-model", "Recurring value increases total value"],
    ["money-model-rules", "money-model", "Rules keep the model simple"],
    ["money-model-rules", "more-better-new", "Iteration needs guardrails"],
    ["lead-getters", "money-model", "Partners may need their own offer path"],
    ["referrals", "attraction-offers", "Referral asks need clear offers"]
  ]
};
