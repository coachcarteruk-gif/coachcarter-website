window.MARKETING_FRAMEWORK = {
  title: "Marketing Map",
  version: 1,
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
    ["more-better-new", "referrals", "Improve referral loops"]
  ]
};
