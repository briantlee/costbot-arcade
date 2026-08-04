/* ============================================================================
 * CostBot Arcade — SHARED TRIVIA BANK
 * ----------------------------------------------------------------------------
 * One bank of FinOps questions, shared by every cabinet that wants to ask one.
 * Waste Hunter asks on level-up; Holiday in Colombia sells bait for a correct
 * answer. Neither owns the questions, so adding one here reaches both.
 *
 * Sourced from the internal "AWS Cost Optimization Strategies" guidance:
 *   skills/optional/cost-optimizations/SKILL.md
 *   (Confluence PRODPLAT — AWS Cost Optimization Strategies)
 *
 * Shape:  { topic, q, c: [choices], a: <index of the correct choice>, why }
 *
 *   ArcadeTrivia.BANK               // the whole array
 *   ArcadeTrivia.topics()           // distinct topic ids
 *   ArcadeTrivia.byTopic('spot')    // questions for one topic
 *   ArcadeTrivia.pick({ exclude })  // one question, avoiding a Set of keys
 *   ArcadeTrivia.key(q)             // stable id, for "already asked" tracking
 * ==========================================================================*/
((global) => {
  'use strict';

  const BANK = [
    // --- graviton -----------------------------------------------------------
    { topic: 'graviton', q: 'Migrating an EC2 workload from Intel to Graviton typically saves about how much?',
      c: ['~5%', '~20%', '~45%', '~70%'], a: 1,
      why: 'Intel → Graviton ≈ 20%. AMD → Graviton ≈ 10%, and Intel → AMD ≈ 10%.' },
    { topic: 'graviton', q: 'Which of these EC2 instance families is actually Graviton?',
      c: ['m5a', 'g5', 'r5', 'm6g'], a: 3,
      why: 'A trailing "g" on the family means Graviton (m6g, c7g, t4g). "g5" is a GPU family — it ends in 5, not g. A trailing "a" (m5a) is AMD.' },
    { topic: 'graviton', q: 'On Mariner (EKS), realistic Graviton savings are closer to…',
      c: ['5–10%', '20%', '35%', '52%'], a: 0,
      why: 'Most Mariner nodes are already AMD, so the move is AMD → Graviton (~10% theoretical). Shared infrastructure makes 5–10% the realistic range.' },
    { topic: 'graviton', q: 'RDS Graviton2 delivers roughly what price/performance improvement?',
      c: ['~12%', '~25%', '~52%', '~80%'], a: 2,
      why: 'RDS Graviton2 is about 35% more performance and ~52% better price/performance.' },
    { topic: 'graviton', q: 'Lambda on ARM/Graviton2 improves price-performance by about…',
      c: ['~34%', '~5%', '~60%', '~90%'], a: 0,
      why: 'Lambda ARM/Graviton2 is up to ~34% better price-performance — usually just an architecture flag change.' },

    // --- spot ---------------------------------------------------------------
    { topic: 'spot', q: 'Spot instances are discounted by up to roughly…',
      c: ['~30%', '~50%', '~70%', '~90%'], a: 3,
      why: 'Spot runs up to ~90% off on-demand — the trade is that AWS can reclaim the capacity at any time.' },
    { topic: 'spot', q: 'Which workload is the BEST Spot candidate?',
      c: ['The primary production database', 'A CI/CD build fleet', 'A stateful session store', 'The payment gateway'], a: 1,
      why: 'Spot suits fault-tolerant work: containers, big data, CI/CD, batch and ML — anything that can be interrupted and retried.' },
    { topic: 'spot', q: 'What is the main risk you design around when adopting Spot?',
      c: ['Slower CPUs', 'Higher data transfer fees', 'Instances can be reclaimed mid-run', 'No CloudWatch metrics'], a: 2,
      why: 'Spot capacity can be interrupted at any time. Diversify across pools and make the workload restart-safe.' },

    // --- commitments --------------------------------------------------------
    { topic: 'commitments', q: 'A 1-year Reserved Instance on stable EC2 usage yields roughly what discount?',
      c: ['~10%', '~30%', '~65%', '~90%'], a: 1,
      why: 'About 30% for 1-year RIs on stable 12-month usage. Contact #cost-management to have it purchased centrally.' },
    { topic: 'commitments', q: 'Reserved capacity on DynamoDB yields roughly what discount?',
      c: ['~15%', '~30%', '~50%', '~75%'], a: 2,
      why: 'DynamoDB reserved capacity runs ~50% for stable 12-month usage. Note ECDA excludes DynamoDB from its DSP.' },
    { topic: 'commitments', q: 'What makes a workload a good Reserved Instance candidate?',
      c: ['It is spiky and unpredictable', 'Stable usage over the next 12 months', 'It runs only on weekends', 'It is already on Spot'], a: 1,
      why: 'Commitments reward predictability. Stable 12-month usage is the bar — spiky workloads belong on on-demand or Spot.' },
    { topic: 'commitments', q: 'Since late 2024, which DynamoDB capacity mode is often cheaper — especially for global tables?',
      c: ['Provisioned', 'On-demand', 'They are identical', 'Neither — use RDS'], a: 1,
      why: 'AWS cut on-demand pricing in Nov 2024, making on-demand frequently the better default, particularly for global tables.' },

    // --- storage ------------------------------------------------------------
    { topic: 'storage', q: 'Moving S3 Standard data to Intelligent Tiering typically saves…',
      c: ['~5–10%', '~40–68%', '~90%+', 'Nothing — it costs more'], a: 1,
      why: 'Intelligent Tiering saves roughly 40–68% on infrequently accessed data, with no performance impact and no retrieval fee on the frequent tier.' },
    { topic: 'storage', q: 'Migrating an EBS volume from gp2 to gp3 saves about…',
      c: ['~20% per GB', '~60% per GB', 'Nothing', '~90% per GB'], a: 0,
      why: 'gp3 is up to ~20% cheaper per GB than gp2 and lets you configure IOPS and throughput independently. Low-effort win.' },
    { topic: 'storage', q: 'You delete an orphaned EBS volume whose instance is long gone. What do you save?',
      c: ['0% — you still pay for the snapshot', '~30%', '~50%', '100% of that volume cost'], a: 3,
      why: 'Deletion is a 100% saving. Snapshot first if you need a backup, then delete — old snapshots of deleted volumes are also 100% savings.' },
    { topic: 'storage', q: 'Which S3 lifecycle transition saves the most?',
      c: ['Standard → Standard-IA (~40%)', 'Standard-IA → Glacier IR (~68%)', 'Glacier Flexible → Deep Archive (~73%)', 'They are all ~10%'], a: 2,
      why: 'Roughly: Standard→SIA 40%, SIA→GIR 68%, Glacier→Deep Archive 73%. Intelligent Tiering spans 40–85%.' },
    { topic: 'storage', q: 'Incomplete multipart uploads sitting in a bucket are…',
      c: ['Free', 'Billed as storage until removed', 'Auto-deleted after 24h', 'Only billed on retrieval'], a: 1,
      why: 'They are billed as storage indefinitely. A lifecycle policy to abort them is a 100% saving on that cost.' },
    { topic: 'storage', q: 'EFS Intelligent Tiering moves rarely-read data to Infrequent Access, saving about…',
      c: ['~20%', '~50%', '~90% on storage', 'Nothing'], a: 2,
      why: 'EFS IA can cut roughly 90% off storage cost for rarely-read data.' },

    // --- extended support ---------------------------------------------------
    { topic: 'extended_support', q: 'You upgrade an engine off an EOL version and the Extended Support fee disappears. What did you save?',
      c: ['~25%', '~50%', '100% of the surcharge', 'Nothing — it is a fixed fee'], a: 2,
      why: 'Extended Support is a pure surcharge for running EOL versions. Upgrading eliminates 100% of it.' },
    { topic: 'extended_support', q: 'How does Year 3 Extended Support pricing compare to Year 1–2?',
      c: ['The same', 'Half the price', 'Double', 'Ten times'], a: 2,
      why: 'Year 3 is roughly 2x Year 1–2 — e.g. MySQL 5.7 at $0.20/vCPU-hr vs $0.10. The cost of waiting compounds.' },
    { topic: 'extended_support', q: 'An ElastiCache Redis cluster on r5 nodes is paying Extended Support. What is the "triple win" upgrade?',
      c: ['Just delete it', 'Redis r5 → Valkey on r7g', 'Move it to Spot', 'Add a read replica'], a: 1,
      why: 'One move kills the Extended Support surcharge, gains Graviton savings, and gains ~20% from Valkey.' },
    { topic: 'extended_support', q: 'Searching the CUR for Extended Support, why filter on BOTH usage_type and description?',
      c: ['It runs faster', 'Some services only expose it in the description', 'Description is always empty', 'To avoid duplicates'], a: 1,
      why: 'Filtering only on line_item_usage_type misses services whose Extended Support charge appears solely in the description field.' },

    // --- kinesis ------------------------------------------------------------
    { topic: 'idle', q: 'A Kinesis EFO consumer that never reads a single byte is billed…',
      c: ['Nothing', 'A per-shard-per-hour registration fee', 'Only on retrieval', 'A one-time setup fee'], a: 1,
      why: 'EFO consumers pay ConsumerHour per shard per hour whether or not they read. Orphaned registrations cost DE&E ~$205K/month.' },
    { topic: 'visibility', q: 'The CUR says a Kinesis consumer has zero retrieval. Before calling it a ghost you must…',
      c: ['Delete it immediately', 'Validate it against Datadog', 'Wait 90 days', 'Open a Jira and move on'], a: 1,
      why: 'The CUR has a known attribution bug — some active consumers show zero retrieval. Confirm absence in Datadog before deregistering.' },
    { topic: 'automation', q: 'Which charge does Kinesis On-Demand Advantage (KODA) eliminate outright?',
      c: ['Ingest per GB', 'ConsumerHour', 'Retrieval per GB', 'Data transfer'], a: 1,
      why: 'KODA collapses billing to ingest + retrieval per GB, eliminating ConsumerHour (and therefore all ghost consumer cost), shardHourStorage and per-stream charges.' },

    // --- idle / retire ------------------------------------------------------
    { topic: 'idle', q: 'Once you know who owns a line item, which optimization lever do you evaluate FIRST?',
      c: ['Buy an RI for it', 'Retire it entirely', 'Move it to Spot', 'Rightsize it'], a: 1,
      why: 'Retire → rightsize → commit, in that order. No discount beats deleting the resource.' },
    { topic: 'idle', q: 'An unattached Elastic IP address is…',
      c: ['Free', 'Billed hourly while unattached', 'Billed only on data transfer', 'Released automatically'], a: 1,
      why: 'Unattached EIPs accrue an hourly charge indefinitely — classic zero-value waste.' },
    { topic: 'idle', q: 'Which AWS tool identifies idle and underutilized EC2 instances for you?',
      c: ['Cost Explorer', 'Compute Optimizer', 'Trusted Advisor Lite', 'CloudTrail'], a: 1,
      why: 'Compute Optimizer surfaces idle instances, underutilized instances and more cost-efficient types, and can be filtered by tag.' },

    // --- rightsizing --------------------------------------------------------
    { topic: 'rightsizing', q: 'ElastiCache Valkey versus Redis on identical nodes is roughly…',
      c: ['20% cheaper', 'The same price', '20% more expensive', 'Only cheaper at scale'], a: 0,
      why: 'Valkey is an API-compatible open-source fork running ~20% cheaper — usually just an engine version upgrade.' },
    { topic: 'rightsizing', q: 'For a provisioned DynamoDB table, how do you decide the new RCU/WCU?',
      c: ['Halve it and hope', 'Compare provisioned vs consumed in Datadog and leave headroom', 'Match the prod table', 'Always switch to on-demand'], a: 1,
      why: 'Pull provisioned vs actual consumed from Datadog/CloudWatch and size to peak with headroom (commonly ~3x peak).' },
    { topic: 'rightsizing', q: 'OpenSearch on Graviton2 gives roughly what price/performance gain?',
      c: ['~10%', '~44%', '~75%', 'None'], a: 1,
      why: 'OpenSearch Graviton2 delivers up to ~44% better price/performance.' },
    { topic: 'rightsizing', q: 'Beyond the nodes themselves, where is the easy ElastiCache/RDS saving?',
      c: ['Retire unused read replicas', 'Increase backup retention', 'Add more shards', 'Enable multi-AZ everywhere'], a: 0,
      why: 'Retire read replicas beyond the failover minimum, or load-balance across them and downsize.' },

    // --- visibility ---------------------------------------------------------
    { topic: 'visibility', q: 'Why should you not quote AWS Cost Explorer figures at Disney?',
      c: ['It is always offline', 'It does not reflect Disney discounted rates', 'It only shows one account', 'It rounds to the nearest $1,000'], a: 1,
      why: 'Cost Explorer shows list-ish pricing and misses Disney negotiated rates. Use it for relative trends only; the CUR is the source of truth.' },
    { topic: 'visibility', q: 'When advising a team, which share of their spend should your recommendations cover?',
      c: ['Every line item', 'The top 70–80%', 'Only anything over $1M', 'Whatever grew last month'], a: 1,
      why: 'Cover the cumulative top 70–80%. Beyond that you flood the team with small tips and bury the actual win.' },
    { topic: 'visibility', q: 'Which is the recommended cost visibility dashboard for most DE&E teams?',
      c: ['Looker (legacy DMED)', 'AWS Spend Multi Dashboard in Databricks', 'Cost Explorer', 'The AWS console billing page'], a: 1,
      why: 'The AWS Spend Multi Dashboard in Databricks is the default; Finout covers cloud/software vendors and Looker only serves legacy DMED accounts.' },

    // --- tagging ------------------------------------------------------------
    { topic: 'tagging', q: 'Why does untagged spend almost never get optimized?',
      c: ['It is always tiny', 'No team owns it, so nobody acts on it', 'AWS hides it', 'It is billed separately'], a: 1,
      why: 'Tags drive allocation and showback. Untagged cost lands in an unowned bucket and no engineer ever sees it.' },
    { topic: 'tagging', q: 'Before you can retire anything at Disney, what do you need?',
      c: ['A Compute Optimizer report', "The owner's approval", 'A 30-day idle window', 'Nothing — just delete it'], a: 1,
      why: 'Ownership comes first — no resource gets retired without owner sign-off. It is also why untagged spend never gets optimized: no owner, no action.' },
    { topic: 'tagging', q: 'In the CUR, Mariner spend should be identified by…',
      c: ["account name", "product_code = 'Mariner'", 'the EKS product name', 'the owning team tag'], a: 1,
      why: "Mariner runs across 26+ streaming accounts, so filter on product_code = 'Mariner' — never by account name." },

    // --- nonprod ------------------------------------------------------------
    { topic: 'nonprod', q: 'A nonprod resource costing what fraction of its prod twin should be flagged?',
      c: ['More than 5%', 'More than 30%', 'More than 90%', 'Only if it exceeds prod'], a: 1,
      why: '>30% is suspicious, >50% is a strong overprovisioning signal, and more than prod is almost certainly a mistake.' },
    { topic: 'nonprod', q: 'Typical reduction available from right-sizing overprovisioned nonprod:',
      c: ['5–10%', '20–30%', '80–90%', 'None — it is already minimal'], a: 2,
      why: 'Teams routinely copy prod provisioning into QA and never revisit it. Cuts of 80–90% are common with no functional impact.' },
    { topic: 'nonprod', q: 'If nonprod resource names have no environment suffix, what do you group by instead?',
      c: ['Region', 'Usage account ID / account name', 'Instance type', 'Give up'], a: 1,
      why: 'Streaming services often use dedicated prod vs nonprod accounts — group by account and flag names containing qa, dev, staging or sandbox.' },

    // --- automation ---------------------------------------------------------
    { topic: 'automation', q: 'By default, CloudWatch log groups created by Lambda retain logs for…',
      c: ['7 days', '30 days', '1 year', 'Forever — there is no expiration'], a: 3,
      why: 'The default is no expiration, so Lambda logs accumulate forever. Setting retention on log groups is a quick, permanent win.' },
    { topic: 'automation', q: 'A service emits logs to both Datadog and CloudWatch. Which should you usually turn off?',
      c: ['Datadog', 'CloudWatch', 'Neither — keep both', 'Both'], a: 1,
      why: 'CloudWatch is generally the more expensive and less usable of the two. Check with the observability team before flipping it off.' },
    { topic: 'automation', q: 'What makes a cost saving durable rather than a one-off?',
      c: ['A bigger spreadsheet', 'Automation — lifecycle rules, schedules, expiry', 'A monthly reminder email', 'Executive escalation'], a: 1,
      why: 'A saving that needs a human every month decays. Encode it: lifecycle policies, instance schedules, log expiry, guardrails.' },

    // --- elasticity ---------------------------------------------------------
    { topic: 'elasticity', q: 'Load testing shows a service falls over at 70% CPU. What autoscaling target do you set?',
      c: ['~50%, keeping a buffer', '70% exactly', '90% for efficiency', '30% to be safe'], a: 0,
      why: 'Target below the failure point so scale-out has time to react — fails at 70% means target ~50%.' },
    { topic: 'elasticity', q: 'The cheapest way to run a nonprod EC2 fleet nobody uses at night is…',
      c: ['Buy RIs for it', 'Schedule it off outside working hours', 'Move it to a bigger instance', 'Enable detailed monitoring'], a: 1,
      why: 'Instance scheduling — spin nonprod and batch fleets down evenings and weekends. Never buy commitments for schedulable capacity.' },
    { topic: 'elasticity', q: 'Over time, what should happen to an autoscaling group minimum size?',
      c: ['Grow it to be safe', 'Ratchet it down to follow real traffic history', 'Freeze it at launch value', 'Match it to max size'], a: 1,
      why: 'Use traffic history to reduce min-size over time. A stale min-size quietly pays for peak capacity 24/7.' },

    // ======================= second wave ===================================
    // --- graviton -----------------------------------------------------------
    { topic: 'graviton', q: 'EMR on Graviton2 runs Spark for roughly…',
      c: ['~35% lower cost and ~15% better performance', 'The same cost', '~5% lower cost', 'Twice the cost'], a: 0,
      why: 'EMR Graviton2 is about 35% cheaper with ~15% better Spark performance. Pair it with Spot and gp3 storage.' },
    { topic: 'graviton', q: 'ElastiCache on Graviton delivers up to what price/performance gain?',
      c: ['~10%', '~25%', '~45%', '~90%'], a: 2,
      why: 'Up to ~45% price/performance, and Graviton2 is the default for new ElastiCache nodes.' },
    { topic: 'graviton', q: 'ElastiCache rows in the CUR have an empty instance-family column. Where do you get the node type?',
      c: ['product_instance_type_family', 'Parse it out of line_item_usage_type', 'It is unavailable', 'From the resource ARN only'], a: 1,
      why: 'Extract it from line_item_usage_type, which follows the pattern [region-]NodeUsage:cache.<family>.<size>.' },
    { topic: 'graviton', q: 'Why exclude ProvisionedAMR and ServerlessAMR when profiling RDS instance families?',
      c: ['They are Aurora capacity units, not instance types', 'They are always Graviton', 'They are free', 'They are nonprod only'], a: 0,
      why: 'Those values are Aurora provisioned/serverless capacity units. Leaving them in pollutes the processor split.' },

    // --- spot ---------------------------------------------------------------
    { topic: 'spot', q: 'What is the standard way to reduce the blast radius of Spot interruptions?',
      c: ['Buy an RI as backup', 'Diversify across instance pools', 'Use only one large instance', 'Disable autoscaling'], a: 1,
      why: 'Spreading a Spot fleet across many instance types and AZs means one pool reclaiming capacity does not take the whole fleet.' },
    { topic: 'spot', q: 'For EMR compute, the guidance is to prefer…',
      c: ['On-demand Intel', 'Graviton and/or Spot', 'The largest instance available', 'Dedicated hosts'], a: 1,
      why: 'EMR profiles should lean on Graviton and Spot — transient cluster work is exactly the fault-tolerant case Spot suits.' },
    { topic: 'spot', q: 'Which container workload is safest to put on Spot?',
      c: ['Stateless request workers', 'The primary state store', 'A singleton leader process', 'The service discovery layer'], a: 0,
      why: 'Stateless, horizontally scalable workers can lose a node and reschedule. Singletons and state stores cannot.' },

    // --- commitments --------------------------------------------------------
    { topic: 'commitments', q: 'A 1-year OpenSearch Reserved Instance saves roughly…',
      c: ['~10%', '~30%', '~55%', '~80%'], a: 1,
      why: 'About 30%, the same ballpark as EC2, ElastiCache and RDS 1-year RIs.' },
    { topic: 'commitments', q: 'Who actually purchases Reserved Instances at Disney?',
      c: ['Each team, on its own card', 'Cost Management with Enterprise Tech and FinOps', 'AWS, automatically', 'Nobody — only Savings Plans are used'], a: 1,
      why: 'RIs are managed centrally. Raise stable 12-month usage with #cost-management rather than buying them yourself.' },
    { topic: 'commitments', q: 'Which service does ECDA exclude from its Databricks Savings Plan?',
      c: ['EC2', 'S3', 'DynamoDB', 'Lambda'], a: 2,
      why: 'ECDA excludes DynamoDB from DSP, so DynamoDB commitments have to be handled separately.' },

    // --- storage ------------------------------------------------------------
    { topic: 'storage', q: 'Moving an EBS volume from io1 to io2 gives you…',
      c: ['Better durability at the same price point', 'Half the price, half the IOPS', 'Nothing at all', 'Cheaper storage but slower'], a: 0,
      why: 'io2 offers better durability at the same price as io1, so it is a free upgrade worth flagging.' },
    { topic: 'storage', q: 'Noncurrent S3 object versions exceed what share of storage before you should review versioning?',
      c: ['1%', '10%', '50%', '90%'], a: 1,
      why: 'Above ~10% of storage, use S3 Lens and add lifecycle rules to expire or tier the noncurrent versions.' },
    { topic: 'storage', q: 'If a bucket uses KMS encryption, which setting reduces the KMS bill?',
      c: ['Disable encryption', 'S3 Bucket Keys', 'Rotate keys more often', 'Switch to a customer-managed key'], a: 1,
      why: 'S3 Bucket Keys cut the number of KMS requests dramatically for KMS-encrypted buckets.' },
    { topic: 'storage', q: 'What is the catch when archiving EBS snapshots?',
      c: ['Only one snapshot per volume can be archived', 'Archiving is instant to restore', 'Archives cost more than standard', 'Archived snapshots expire in 30 days'], a: 0,
      why: 'You can only archive one snapshot per volume, so pick the one worth keeping before you archive.' },
    { topic: 'storage', q: 'For EMR cluster storage, which volume type should you use?',
      c: ['gp2', 'gp3', 'io1', 'st1'], a: 1,
      why: 'Use gp3 rather than gp2 — cheaper per GB with independently configurable IOPS and throughput.' },
    { topic: 'storage', q: 'Beyond lifecycle rules, which two habits reduce S3 cost at the application layer?',
      c: ['Compress before upload and repack tiny objects', 'Upload more often and in smaller pieces', 'Duplicate across regions', 'Disable multipart uploads'], a: 0,
      why: 'Compressing before upload and repacking many small objects cuts both stored bytes and per-request overhead.' },
    { topic: 'storage', q: 'A high-volume replicated DynamoDB table is burning KMS cost. What is the lever?',
      c: ['Turn off encryption', 'Use AWS owned keys instead of a CMK', 'Add more replicas', 'Switch to provisioned capacity'], a: 1,
      why: 'For high-volume or replicated tables, AWS owned keys eliminate the KMS charge that a customer-managed key incurs.' },

    // --- extended support ---------------------------------------------------
    { topic: 'extended_support', q: 'Which CUR usage type signals an EKS cluster on an EOL Kubernetes version?',
      c: ['AmazonEKS-Hours:extendedSupport', 'EKS-LegacyCluster', 'EKS:OldVersion', 'AmazonEKS-EOL'], a: 0,
      why: 'AmazonEKS-Hours:extendedSupport. Upgrading the cluster version removes the surcharge entirely.' },
    { topic: 'extended_support', q: 'Which of these services does NOT commonly carry an Extended Support surcharge?',
      c: ['RDS', 'ElastiCache', 'OpenSearch', 'S3'], a: 3,
      why: 'Extended Support applies to versioned engines — RDS, ElastiCache, EKS and OpenSearch. S3 has no engine version to age out.' },

    // --- idle ---------------------------------------------------------------
    { topic: 'idle', q: 'How do you confirm an ALB is genuinely idle before deleting it?',
      c: ['Check the request count in Datadog', 'Assume it is idle if it is old', 'Look at the instance count', 'Check the ARN naming'], a: 0,
      why: 'Check request count in Datadog. The fixed hourly ALB charge (~$0.0225/hr) is not optimizable any other way.' },
    { topic: 'idle', q: 'Migrating a Kinesis stream from Provisioned to On-Demand eliminates which charge?',
      c: ['ConsumerHour', 'shardHourStorage', 'PutRequest', 'Data transfer'], a: 1,
      why: 'It removes per-shard storage cost. ConsumerHour still applies on On-Demand streams — ghosts keep billing until deregistered.' },
    { topic: 'idle', q: 'What is the Unused Object Report for?',
      c: ['Tracking RI expiry', 'Surfacing low-effort cost reduction candidates', 'Listing untagged accounts', 'Auditing IAM roles'], a: 1,
      why: 'It is a standing list of unused resources — some of the lowest-effort savings available.' },
    { topic: 'idle', q: 'Under KODA, what happens to retrieval cost if you drop EFO for standard consumers?',
      c: ['It doubles', 'It becomes free', 'It stays the same', 'EFO cannot be dropped'], a: 1,
      why: 'Standard (non-EFO) retrieval is free under KODA, which is why dropping unnecessary EFO registrations is the biggest KODA win.' },

    // --- visibility ---------------------------------------------------------
    { topic: 'visibility', q: 'Finout is the cost visibility platform for…',
      c: ['Only EC2', 'DE&E cloud and software vendors', 'Legacy DMED accounts', 'Databricks alone'], a: 1,
      why: 'Finout covers DE&E cloud and software vendor spend. Legacy DMED reporting lives in Looker.' },
    { topic: 'visibility', q: 'ConsumerHour is more than half of a team Kinesis bill. What does that tell you?',
      c: ['Throughput is the driver', 'Check for ghost consumers and evaluate KODA', 'They need more shards', 'Retention is too long'], a: 1,
      why: 'ConsumerHour dominance points straight at EFO registrations — hunt ghosts, then model KODA, which removes the charge entirely.' },
    { topic: 'visibility', q: 'Where do you go for a customized TCO or cost analysis help?',
      c: ['#cost-management or an OCMT Jira', 'AWS Support only', 'The Looker admin', 'Open a PagerDuty incident'], a: 0,
      why: 'The #cost-management channel or an OCMT Jira ticket. For AWS-side help there is also a dedicated Global Account Manager.' },
    { topic: 'visibility', q: 'Under KODA, what is the per-region minimum you are billed for?',
      c: ['No minimum', '25 MiB/s ingest and 25 MiB/s retrieval', '1 GB/day', '100 shards'], a: 1,
      why: 'KODA carries a per-region floor of 25 MiB/s ingest plus 25 MiB/s retrieval, billed whether you use it or not — model per-stream before committing.' },
    { topic: 'visibility', q: 'Why can KODA cost MORE for a high-EFO stream?',
      c: ['It charges per shard', 'EFO retrieval reprices about 3x higher', 'It has no discount', 'It bills per consumer'], a: 1,
      why: 'EFO retrieval goes from roughly $0.013/GB to $0.04/GB retail under KODA. Model per-stream before committing.' },

    // --- tagging ------------------------------------------------------------
    { topic: 'tagging', q: 'How do you isolate the EC2 and storage cost belonging to an EMR cluster?',
      c: ['By account only', 'With tags', 'It cannot be separated', 'By region'], a: 1,
      why: 'Tag the cluster so its EC2 and storage lines can be attributed, the same way autoscaling groups are isolated.' },
    { topic: 'tagging', q: 'Yotascale, previously used for Mariner and Donki cost views, is now…',
      c: ['The recommended tool', 'Decommissioned', 'Only for RDS', 'Renamed to Finout'], a: 1,
      why: 'Yotascale is decommissioned. Mariner and Donki cost views come from the CUR and Datadog utilization dashboards now.' },
    { topic: 'tagging', q: 'What does tagging unlock beyond a tidy bill?',
      c: ['Faster instances', 'Showback, so teams see and own their own spend', 'Automatic discounts', 'Longer log retention'], a: 1,
      why: 'Tags drive allocation and showback. Once a team sees its own number, the waste tends to stop arriving.' },

    // --- nonprod ------------------------------------------------------------
    { topic: 'nonprod', q: 'Why is nonprod usually the best place to start right-sizing?',
      c: ['It is the largest spend', 'Low risk, no production impact, high reward', 'AWS discounts it further', 'It is easier to tag'], a: 1,
      why: 'Nonprod right-sizing carries no production risk and routinely returns 80-90%. It is the safest big win available.' },
    { topic: 'nonprod', q: 'Which is the classic nonprod overprovisioning pattern?',
      c: ['A QA DynamoDB table at prod RCU/WCU', 'A dev bucket with lifecycle rules', 'A staging Lambda with 128MB', 'A sandbox with no resources'], a: 0,
      why: 'Teams copy the prod provisioning into QA and never revisit it — the same happens with ElastiCache node counts and RDS sizes.' },

    // --- automation ---------------------------------------------------------
    { topic: 'automation', q: 'What is Ballast?',
      c: ['A cost dashboard', 'Tooling that auto-fixes non-compliant resources', 'An RI purchasing service', 'A Databricks cluster policy'], a: 1,
      why: 'Ballast automatically remediates non-compliant resources across standardization, security and cost.' },
    { topic: 'automation', q: 'Besides moving to ARM, what reduces Lambda cost?',
      c: ['Smaller deployment packages and dependencies', 'More memory always', 'Longer timeouts', 'More concurrent executions'], a: 0,
      why: 'Trimming package size and dependencies cuts cold-start work; a right-sized memory profile is the other main lever.' },
    { topic: 'automation', q: 'Which CloudWatch Logs cleanup is pure profit?',
      c: ['Deleting log groups nothing writes to any more', 'Raising the retention period', 'Enabling more log streams', 'Adding subscription filters'], a: 0,
      why: 'Orphaned log groups from decommissioned services keep billing for stored data. Delete them and set retention on the rest.' },
    { topic: 'automation', q: 'PutRequest billing units in Kinesis are rounded to…',
      c: ['1 KB', '25 KB', '1 MB', 'They are not rounded'], a: 1,
      why: 'PutRequest bills in 25KB-rounded units, so actual ingested bytes can be 5-25x lower than the billed figure suggests.' },
    { topic: 'automation', q: 'Which Kinesis charge does On-Demand Advantage (KODA) eliminate outright?',
      c: ['Ingest per GB', 'ConsumerHour', 'Retrieval per GB', 'Data transfer'], a: 1,
      why: 'KODA collapses billing to ingest + retrieval per GB, eliminating ConsumerHour, shardHourStorage and per-stream charges.' },

    // --- elasticity ---------------------------------------------------------
    { topic: 'elasticity', q: 'Which EFS throughput mode should you pick?',
      c: ['Always Provisioned', 'Whichever of Bursting, Provisioned or Elastic matches the workload', 'Always Bursting', 'Throughput mode does not affect cost'], a: 1,
      why: 'EFS offers Bursting, Provisioned and Elastic. Provisioned on a bursty workload is a common overspend.' },
    { topic: 'elasticity', q: 'OpenSearch Serverless is aimed at which workload shape?',
      c: ['Steady 24/7 high volume', 'Infrequent, intermittent or unpredictable', 'Anything with an RI', 'Batch only'], a: 1,
      why: 'Serverless suits infrequent, intermittent or unpredictable usage where a provisioned domain sits idle.' },
    { topic: 'elasticity', q: 'An RDS instance is only used during business hours. What is the lever?',
      c: ['Buy a 3-year RI', 'Run it off-hours-stopped on a schedule', 'Add a read replica', 'Increase storage'], a: 1,
      why: 'RDS off-hours scheduling for windows of known inactivity. Never buy commitments for capacity you could switch off.' },
    { topic: 'elasticity', q: 'What is the prerequisite before an account can enable KODA?',
      c: ['A 3-year commitment', 'Streams must already be in On-Demand mode', 'All EFO consumers removed', 'A dedicated region'], a: 1,
      why: 'The path is Provisioned to On-Demand to KODA. On-Demand mode is the gate.' },

    // --- rightsizing --------------------------------------------------------
    { topic: 'rightsizing', q: 'For Donki and Janus (ECS), what do you tune?',
      c: ['Memory and CPU reservations, from the utilization dashboards', 'The load balancer', 'The AMI', 'Log retention'], a: 0,
      why: 'Both have Datadog utilization stats showing ECS memory and CPU. Overprovisioned container reservations are the usual finding.' },
    { topic: 'rightsizing', q: 'Which dashboard drives Mariner (EKS) right-sizing?',
      c: ['EKS Provisioning Analysis in Datadog', 'Cost Explorer', 'The Mariner console', 'S3 Storage Lens'], a: 0,
      why: 'The EKS Provisioning Analysis dashboard shows request versus actual utilization per namespace and service.' },
    { topic: 'rightsizing', q: 'What is the ElastiCache read-replica lever?',
      c: ['Add replicas to spread cost', 'Retire replicas beyond the failover minimum, or load-balance and downsize', 'Convert them to primaries', 'Nothing — replicas are free'], a: 1,
      why: 'Keep what failover requires. Beyond that, either retire the extras or spread reads across them and shrink the node size.' },
    { topic: 'rightsizing', q: 'Where should a spiky DynamoDB workload start before switching to on-demand?',
      c: ['Straight to on-demand', 'Pre-warm in provisioned, then switch', 'Provisioned forever', 'Split into two tables'], a: 1,
      why: 'Pre-warming in provisioned adds partitions that persist, so on-demand can then absorb spikes up to that level.' },
  ];

  // A question's text is its identity — the bank has no ids, and adding one in
  // the middle must not invalidate every "already asked" set in a saved profile.
  const key = (q) => q.q;

  const topics = () => Array.from(new Set(BANK.map((q) => q.topic)));

  const byTopic = (t) => BANK.filter((q) => q.topic === t);

  // Draw one question, preferring a topic and avoiding anything already asked.
  // Falls back through: unseen-in-topic -> unseen-anywhere -> anything at all,
  // so a caller that exhausts the bank keeps getting questions instead of null.
  function pick(opts) {
    const o = opts || {};
    const seen = o.exclude instanceof Set ? o.exclude : new Set(o.exclude || []);
    const pools = [];
    if (o.topic) pools.push(byTopic(o.topic).filter((q) => !seen.has(key(q))));
    pools.push(BANK.filter((q) => !seen.has(key(q))));
    if (o.allowRepeats !== false) pools.push(o.topic ? byTopic(o.topic) : BANK);
    for (const pool of pools) {
      if (pool.length) return pool[(Math.random() * pool.length) | 0];
    }
    return null;
  }

  global.ArcadeTrivia = { BANK, key, topics, byTopic, pick };
})(typeof window !== 'undefined' ? window : globalThis);
