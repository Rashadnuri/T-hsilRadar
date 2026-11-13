import {
  Award,
  BookOpen,
  Briefcase,
  Code2,
  FlaskConical,
  Globe2,
  GraduationCap,
  HandCoins,
  Sparkles,
  Sun,
  Trophy,
  University,
  type LucideIcon,
} from "lucide-react";
import type { OpportunityType } from "@/types/opportunity";

/** Presentation metadata per opportunity type. Labels come from messages: opportunityTypes.<code>. */
export const opportunityTypeIcons: Record<OpportunityType, LucideIcon> = {
  scholarship: GraduationCap,
  internship: Briefcase,
  grant: HandCoins,
  admission: University,
  exchange: Globe2,
  training: BookOpen,
  certification: Award,
  summer_school: Sun,
  hackathon: Code2,
  competition: Trophy,
  research: FlaskConical,
  other: Sparkles,
};
