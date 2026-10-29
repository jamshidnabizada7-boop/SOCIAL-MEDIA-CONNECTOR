import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  CalendarDays,
  CreditCard,
  FolderOpen,
  Home,
  Compass,
  Inbox,
  ListOrdered,
  PenSquare,
  Settings,
  ShieldCheck,
  Users,
  UserRound,
  Clapperboard,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: "attention";
  disabled?: boolean;
  disabledNote?: string;
  adminOnly?: boolean;
  section: "workspace" | "configure";
  accent?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/feed", label: "Home", icon: Home, section: "workspace" },
  { href: "/explore", label: "Explore", icon: Compass, section: "workspace" },
  { href: "/dashboard", label: "Studio", icon: Clapperboard, section: "workspace" },
  { href: "/composer", label: "Create", icon: PenSquare, section: "workspace", accent: true },
  { href: "/calendar", label: "Calendar", icon: CalendarDays, section: "workspace" },
  { href: "/queue", label: "Queue", icon: ListOrdered, section: "workspace" },
  { href: "/posts", label: "Posts", icon: FolderOpen, section: "workspace" },
  { href: "/content", label: "Content", icon: FolderOpen, section: "workspace" },
  { href: "/analytics", label: "Analytics", icon: BarChart3, section: "workspace" },
  { href: "/inbox", label: "Inbox", icon: Inbox, section: "workspace" },
  { href: "/accounts", label: "Social accounts", icon: ShieldCheck, section: "configure" },
  { href: "/team", label: "Team", icon: Users, section: "configure" },
  { href: "/settings", label: "Settings", icon: Settings, section: "configure" },
  { href: "/billing", label: "Billing", icon: CreditCard, section: "configure" },
  { href: "/admin", label: "Admin", icon: ShieldCheck, section: "configure", adminOnly: true },
];

export const MOBILE_NAV = [
  { href: "/feed", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/composer", label: "Create", icon: PenSquare },
  { href: "/inbox", label: "Inbox", icon: Inbox },
  { href: "/accounts", label: "Profile", icon: UserRound },
];

export const PROFILE_HREF = "/settings?tab=profile";
export const USER_ICON = UserRound;
