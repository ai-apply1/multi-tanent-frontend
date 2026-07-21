/**
 * AWS regions the admin picks from when connecting their AWS account, so the
 * region can never be misspelled. Code first (what the admin recognises from
 * AWS), city in parentheses. No em/en dash per the repo-wide UI rule.
 *
 * This list is intentionally duplicated in the SUPER-ADMIN dashboard
 * (`multi-tenant-super-admin-dashboard/src/features/organizations/awsRegions.ts`):
 * the two apps are separate packages with no shared code, so the region a
 * self-serving org admin picks and the one a super admin picks come from
 * matching copies. Add a region to BOTH files.
 */
export interface AwsRegion {
  value: string
  label: string
}

export const AWS_REGIONS: AwsRegion[] = [
  { value: "us-east-1", label: "us-east-1 (US East, N. Virginia)" },
  { value: "us-east-2", label: "us-east-2 (US East, Ohio)" },
  { value: "us-west-1", label: "us-west-1 (US West, N. California)" },
  { value: "us-west-2", label: "us-west-2 (US West, Oregon)" },
  { value: "ca-central-1", label: "ca-central-1 (Canada, Central)" },
  { value: "eu-west-1", label: "eu-west-1 (Europe, Ireland)" },
  { value: "eu-west-2", label: "eu-west-2 (Europe, London)" },
  { value: "eu-west-3", label: "eu-west-3 (Europe, Paris)" },
  { value: "eu-central-1", label: "eu-central-1 (Europe, Frankfurt)" },
  { value: "eu-north-1", label: "eu-north-1 (Europe, Stockholm)" },
  { value: "eu-south-1", label: "eu-south-1 (Europe, Milan)" },
  { value: "ap-south-1", label: "ap-south-1 (Asia Pacific, Mumbai)" },
  { value: "ap-southeast-1", label: "ap-southeast-1 (Asia Pacific, Singapore)" },
  { value: "ap-southeast-2", label: "ap-southeast-2 (Asia Pacific, Sydney)" },
  { value: "ap-northeast-1", label: "ap-northeast-1 (Asia Pacific, Tokyo)" },
  { value: "ap-northeast-2", label: "ap-northeast-2 (Asia Pacific, Seoul)" },
  { value: "ap-northeast-3", label: "ap-northeast-3 (Asia Pacific, Osaka)" },
  { value: "ap-east-1", label: "ap-east-1 (Asia Pacific, Hong Kong)" },
  { value: "sa-east-1", label: "sa-east-1 (South America, Sao Paulo)" },
  { value: "me-south-1", label: "me-south-1 (Middle East, Bahrain)" },
  { value: "me-central-1", label: "me-central-1 (Middle East, UAE)" },
  { value: "af-south-1", label: "af-south-1 (Africa, Cape Town)" },
]
