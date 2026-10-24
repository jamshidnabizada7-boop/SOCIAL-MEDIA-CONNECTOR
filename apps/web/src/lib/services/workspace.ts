import type { Brand, Plan, Subscription, Usage, User, Workspace, Invoice } from "../types";
import { INVOICES, SUBSCRIPTION, USAGE, USERS, WORKSPACES } from "../mock/data";
import { DATA_MODE } from "@/lib/api/client";
import { ApiWorkspaceService } from "@/lib/services/backend";
import { Notifier, latency, loadPersisted, persistDebounced } from "./core";
import { uid } from "../utils";

export interface PlanOffer {
  id: Plan["id"];
  name: string;
  priceMonthly: number;
  tagline: string;
  highlights: string[];
  channels: number | "unlimited";
}

export const PLAN_OFFERS: PlanOffer[] = [
  {
    id: "free",
    name: "Free",
    priceMonthly: 0,
    tagline: "Try the whole workflow with 3 channels.",
    channels: 3,
    highlights: ["3 connected channels", "1 brand", "Unlimited drafts", "50 scheduled posts / month", "1 GB media storage"],
  },
  {
    id: "creator",
    name: "Creator",
    priceMonthly: 19,
    tagline: "For a personal brand across every network.",
    channels: 10,
    highlights: ["10 connected channels", "3 brands", "Unlimited scheduled posts", "50 GB media storage", "500 AI credits / month"],
  },
  {
    id: "pro",
    name: "Pro",
    priceMonthly: 49,
    tagline: "Teams publishing serious volume.",
    channels: 25,
    highlights: ["25 connected channels", "10 brands", "10 team seats", "250 GB storage", "2,000 AI credits / month", "API access (beta)"],
  },
  {
    id: "agency",
    name: "Agency",
    priceMonthly: 149,
    tagline: "Client workspaces, approvals and reporting.",
    channels: "unlimited",
    highlights: ["Unlimited channels & workspaces", "Approval workflows", "Client reporting exports", "1 TB storage", "Priority support"],
  },
];

/**
 * Workspace, team and settings data.
 * Real implementation: workspaces/brands tables, RBAC, invitations, settings.
 */
export interface WorkspaceService {
  subscribe(fn: () => void): () => void;
  workspaces(): Workspace[];
  get(id: string): Workspace | undefined;
  updateWorkspace(id: string, patch: Partial<Pick<Workspace, "name" | "timezone" | "locale">>): Promise<void>;
  addBrand(workspaceId: string, brand: { name: string; description?: string }): Promise<Brand>;
  removeBrand(brandId: string): Promise<void>;
  members(): User[];
  /** API-mode async loader (no-op fetch in mock mode). */
  membersAsync?(): Promise<User[]>;
  refreshWorkspaces?(): Promise<Workspace[]>;
  invite(email: string, role: User["role"]): Promise<User>;
  updateMemberRole(id: string, role: User["role"]): Promise<void>;
  removeMember(id: string): Promise<void>;
  subscription(): Subscription;
  usage(): Usage;
  invoices(): Invoice[];
  changePlan(plan: PlanOffer): Promise<void>;
}

class MockWorkspaceService implements WorkspaceService {
  private notifier = new Notifier();
  private saved = loadPersisted<{ workspaces: Workspace[]; users: User[]; subscription: Subscription; usage: Usage; invoices: Invoice[] } | null>("workspace") ?? null;
  private wsList: Workspace[] = this.saved?.workspaces ?? WORKSPACES.map((w) => ({ ...w, brands: [...w.brands] }));
  private users: User[] = this.saved?.users ?? USERS.map((u) => ({ ...u }));
  private subState: Subscription = this.saved?.subscription ?? { ...SUBSCRIPTION };
  private usageState: Usage = this.saved?.usage ?? { ...USAGE };
  private invoiceList: Invoice[] = this.saved?.invoices ?? [...INVOICES];

  constructor() {
    this.notifier.subscribe(() =>
      persistDebounced("workspace", () => ({
        workspaces: this.wsList,
        users: this.users,
        subscription: this.subState,
        usage: this.usageState,
        invoices: this.invoiceList,
      }))
    );
  }

  subscribe(fn: () => void) {
    return this.notifier.subscribe(fn);
  }

  workspaces(): Workspace[] {
    return this.wsList;
  }

  get(id: string): Workspace | undefined {
    return this.wsList.find((w) => w.id === id);
  }

  async updateWorkspace(id: string, patch: Partial<Workspace>): Promise<void> {
    await latency();
    this.wsList = this.wsList.map((w) => (w.id === id ? { ...w, ...patch } : w));
    this.notifier.emit();
  }

  async addBrand(workspaceId: string, brand: { name: string; description?: string }): Promise<Brand> {
    await latency();
    const created: Brand = { id: uid("brand"), name: brand.name, description: brand.description, hue: Math.floor(Math.random() * 360) };
    this.wsList = this.wsList.map((w) =>
      w.id === workspaceId ? { ...w, brands: [...w.brands, created] } : w
    );
    this.notifier.emit();
    return created;
  }

  async removeBrand(brandId: string): Promise<void> {
    await latency();
    this.wsList = this.wsList.map((w) => ({ ...w, brands: w.brands.filter((b) => b.id !== brandId) }));
    this.notifier.emit();
  }

  members(): User[] {
    return this.users;
  }

  async invite(email: string, role: User["role"]): Promise<User> {
    await latency();
    const member: User = {
      id: uid("usr"),
      name: email.split("@")[0].replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      email,
      avatarHue: Math.floor(Math.random() * 360),
      role,
      lastActiveAt: new Date().toISOString(),
      status: "invited",
    };
    this.users = [...this.users, member];
    this.notifier.emit();
    return member;
  }

  async updateMemberRole(id: string, role: User["role"]): Promise<void> {
    await latency("fast");
    this.users = this.users.map((u) => (u.id === id ? { ...u, role } : u));
    this.notifier.emit();
  }

  async removeMember(id: string): Promise<void> {
    await latency("fast");
    this.users = this.users.filter((u) => u.id !== id);
    this.notifier.emit();
  }

  subscription(): Subscription {
    return this.subState;
  }

  usage(): Usage {
    return this.usageState;
  }

  invoices(): Invoice[] {
    return this.invoiceList;
  }

  async changePlan(plan: PlanOffer): Promise<void> {
    await latency("slow");
    this.subState = {
      ...this.subState,
      plan: {
        id: plan.id,
        name: plan.name,
        priceMonthly: plan.priceMonthly,
        channels: plan.channels,
        brands: 10,
        members: 10,
        scheduledPostsPerMonth: "unlimited",
        storageGb: 250,
        aiCredits: 2000,
        highlights: plan.highlights,
      },
      renewsAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    };
    this.notifier.emit();
  }
}

export const workspaceService: WorkspaceService =
  DATA_MODE === "api" ? new ApiWorkspaceService() : new MockWorkspaceService();
