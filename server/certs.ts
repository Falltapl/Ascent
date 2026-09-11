/**
 * AWS exam-guide domains with their OFFICIAL scored weightings.
 *
 * These percentages come from the published AWS exam guides (CLF-C02 and
 * SAA-C03). They matter: progress is weighted by them, so "62% ready" is a
 * real number tied to how the exam is actually scored, not a decorative bar.
 */
export type Domain = { id: string; name: string; weight: number; tasks: string[] }
export type CertBlueprint = {
  code: string
  name: string
  short: string
  /** Credly badge template name, used to auto-detect the earned badge. */
  badgeMatch: string
  passingScore: number
  scaledRange: [number, number]
  questions: number
  minutes: number
  costUSD: number
  validYears: number
  domains: Domain[]
}

export const CERTS: CertBlueprint[] = [
  {
    code: 'CLF-C02',
    name: 'AWS Certified Cloud Practitioner',
    short: 'Cloud Practitioner',
    badgeMatch: 'cloud practitioner',
    passingScore: 700,
    scaledRange: [100, 1000],
    questions: 65,
    minutes: 90,
    costUSD: 100,
    validYears: 3,
    domains: [
      { id: 'clf1', name: 'Cloud Concepts', weight: 24, tasks: [
        'Define the AWS Cloud and its value proposition',
        'Identify aspects of AWS Cloud economics',
        'Explain the different cloud architecture design principles',
        'Understand the AWS Well-Architected Framework',
      ]},
      { id: 'clf2', name: 'Security and Compliance', weight: 30, tasks: [
        'Understand the AWS shared responsibility model',
        'Understand AWS Cloud security, governance, and compliance',
        'Identify AWS access management capabilities (IAM)',
        'Identify components and resources for security',
      ]},
      { id: 'clf3', name: 'Cloud Technology and Services', weight: 34, tasks: [
        'Define methods of deploying and operating in AWS',
        'Define the AWS global infrastructure',
        'Identify compute services (EC2, Lambda, ECS)',
        'Identify database services (RDS, DynamoDB, Aurora)',
        'Identify network services (VPC, Route 53, CloudFront)',
        'Identify storage services (S3, EBS, EFS, Glacier)',
        'Identify AI/ML and analytics services',
      ]},
      { id: 'clf4', name: 'Billing, Pricing, and Support', weight: 12, tasks: [
        'Compare AWS pricing models (On-Demand, Reserved, Spot, Savings Plans)',
        'Understand resources for billing, budget, and cost management',
        'Identify AWS technical resources and support options',
      ]},
    ],
  },
  {
    code: 'SAA-C03',
    name: 'AWS Certified Solutions Architect – Associate',
    short: 'Solutions Architect',
    badgeMatch: 'solutions architect',
    passingScore: 720,
    scaledRange: [100, 1000],
    questions: 65,
    minutes: 130,
    costUSD: 150,
    validYears: 3,
    domains: [
      { id: 'saa1', name: 'Design Secure Architectures', weight: 30, tasks: [
        'Design secure access to AWS resources (IAM roles, policies, SCPs)',
        'Design secure workloads and applications',
        'Determine appropriate data security controls (KMS, encryption at rest/in transit)',
      ]},
      { id: 'saa2', name: 'Design Resilient Architectures', weight: 26, tasks: [
        'Design scalable and loosely coupled architectures (SQS, SNS, EventBridge)',
        'Design highly available and fault-tolerant architectures (Multi-AZ, ASG, ELB)',
        'Understand RTO/RPO and disaster recovery strategies',
      ]},
      { id: 'saa3', name: 'Design High-Performing Architectures', weight: 24, tasks: [
        'Determine high-performing and elastic compute solutions',
        'Determine high-performing and scalable storage solutions',
        'Determine high-performing networking architectures',
        'Determine high-performing data ingestion and transformation',
      ]},
      { id: 'saa4', name: 'Design Cost-Optimized Architectures', weight: 20, tasks: [
        'Design cost-optimized storage solutions (S3 lifecycle, tiering)',
        'Design cost-optimized compute solutions (Spot, Savings Plans, right-sizing)',
        'Design cost-optimized database and network solutions',
      ]},
    ],
  },
]

/** Weighted readiness: each domain contributes in proportion to its exam weight. */
export function readiness(
  cert: CertBlueprint,
  confidence: Record<string, number>, // domainId -> 0..100
): number {
  const total = cert.domains.reduce((s, d) => s + d.weight, 0)
  const got = cert.domains.reduce(
    (s, d) => s + d.weight * ((confidence[d.id] ?? 0) / 100),
    0,
  )
  return Math.round((got / total) * 100)
}

/** Predicted scaled score, mapped onto the real 100–1000 reporting range. */
export function predictedScore(cert: CertBlueprint, confidence: Record<string, number>): number {
  const [lo, hi] = cert.scaledRange
  return Math.round(lo + (readiness(cert, confidence) / 100) * (hi - lo))
}
