"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  CircleAlert,
  Hash,
  Info,
  Link2,
  RotateCcw,
  SmilePlus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import type { MediaAsset, ProviderId, SocialAccount, VariantOverride } from "@/lib/types";
import { PROVIDERS } from "@/lib/providers";
import { accountsService } from "@/lib/services/accounts";
import { mediaService } from "@/lib/services/media";
import { postsService } from "@/lib/services/posts";
import { useSubscribe } from "@/lib/services/hooks";
import { evaluateCompatibility, type CompatFix, type CompatIssue } from "@/lib/compat";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, Checkbox, Field, Input, Select, Skeleton, Switch, Textarea, Tooltip } from "@/components/ui/primitives";
import { Dialog, Popover } from "@/components/ui/dialog";
import { MediaThumb } from "@/components/ui/media-thumb";
import { ProviderBadge } from "@/components/ui/status";
import { DestinationPanel } from "@/components/composer/destination-panel";
import { NetworkPreview } from "@/components/composer/previews";
import { ScheduleDialog } from "@/components/composer/schedule-dialog";
import { ConnectAccountFlow as ConnectFlow } from "@/components/accounts/connect-flow";
import { useSession, useToast } from "@/components/providers";
import { apiPost, DATA_MODE } from "@/lib/api/client";
import { cn, formatBytes, formatDuration } from "@/lib/utils";

const EMOJIS = ["🚀", "✨", "🎉", "💡", "🔥", "📸", "🎬", "📈", "🙌", "👀", "🎯", "✅", "💬", "🌍", "☕", "🧵", "📌", "🗓️", "❤️", "👍", "🤝", "😄", "🤔", "⭐"];
const HASHTAGS = ["#CreateOnce", "#PublishEverywhere", "#BehindTheScenes", "#LaunchDay", "#ContentTips", "#CreatorLife", "#ProductUpdate"];
const CAMPAIGNS = ["", "Spring launch", "Evergreen tips", "Events"];
const PINTEREST_BOARDS = [
  { id: "brd_quotes", label: "Quotes & mindset" },
  { id: "brd_events", label: "Events" },
  { id: "brd_products", label: "Product shots" },
  { id: "brd_tips", label: "Tips & tutorials" },
];
const YT_CATEGORIES = ["Science & Technology", "Education", "Howto & Style", "Entertainment", "People & Blogs"];

function adaptCaption(provider: ProviderId, caption: string): string {
  const base = caption.trim();
  if (!base) return "";
  switch (provider) {
    case "x":
      return base.length > 260 ? `${base.slice(0, 257)}…` : base;
    case "threads":
      return base.length > 480 ? `${base.slice(0, 477)}…` : base;
    case "linkedin":
      return `${base}\n\nCurious how other teams handle this? Would love to hear your approach in the comments.`;
    case "instagram":
      return `${base}\n.\n.\n.\n#CreateOnce #PublishEverywhere #BehindTheScenes`;
    case "tiktok":
      return `${base.slice(0, 140)} #fyp #CreatorLife`;
    case "youtube":
      return base;
    case "pinterest":
      return base.slice(0, 480);
    default:
      return base;
  }
}

interface UploadTask {
  key: string;
  name: string;
  pct: number;
}

function ComposerInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { session } = useSession();
  const toast = useToast();

  useSubscribe(accountsService);
  useSubscribe(mediaService);

  const [loaded, setLoaded] = useState(false);
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [mediaList, setMediaList] = useState<MediaAsset[]>([]);

  // Draft state
  const [editId, setEditId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [link, setLink] = useState("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [mediaIds, setMediaIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [campaign, setCampaign] = useState("");
  const [labels, setLabels] = useState<string[]>([]);
  const [labelInput, setLabelInput] = useState("");
  const [aiDisclosed, setAiDisclosed] = useState(false);
  const [variants, setVariants] = useState<VariantOverride[]>([]);

  // UI state
  const [customize, setCustomize] = useState(false);
  const [activeVariant, setActiveVariant] = useState<ProviderId | null>(null);
  const [previewProvider, setPreviewProvider] = useState<ProviderId | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [detailMedia, setDetailMedia] = useState<MediaAsset | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fixing, setFixing] = useState<string | null>(null);
  const captionRef = useRef<HTMLTextAreaElement>(null);
  const [emojiAnchor, setEmojiAnchor] = useState<number | null>(null);

  useEffect(() => {
    const read = () => {
      setAccounts(accountsService.list());
      setMediaList(mediaService.list());
      setLoaded(true);
    };
    Promise.all([accountsService.listAsync(), mediaService.listAsync()]).then(read);
    const unsubs = [accountsService.subscribe(read), mediaService.subscribe(read)];
    return () => unsubs.forEach((u) => u());
  }, []);

  // Prefill from ?draft=
  useEffect(() => {
    const draftId = params.get("draft");
    if (!draftId || !loaded) return;
    const post = postsService.get(draftId);
    if (!post || post.state !== "draft") return;
    setEditId(post.id);
    setTitle(post.title);
    setCaption(post.caption);
    setLink(post.link ?? "");
    setLinkOpen(!!post.link);
    setMediaIds(post.mediaIds);
    setSelected(post.targets.map((t) => t.accountId));
    setCampaign(post.campaign ?? "");
    setLabels(post.labels ?? []);
    setAiDisclosed(!!post.aiDisclosed);
    setVariants((post.variants ?? []).map((v) => ({ ...v })));
  }, [params, loaded]);

  const media = useMemo(
    () => mediaIds.map((id) => mediaList.find((m) => m.id === id)).filter((m): m is MediaAsset => !!m),
    [mediaIds, mediaList]
  );

  const issues = useMemo(
    () =>
      evaluateCompatibility({
        caption,
        mediaIds,
        variants,
        accountIds: selected,
        accounts,
        media: mediaList,
      }),
    [caption, mediaIds, variants, selected, accounts, mediaList]
  );
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");
  const tips = issues.filter((i) => i.severity === "tip");

  const selectedAccounts = useMemo(
    () => selected.map((id) => accounts.find((a) => a.id === id)!).filter(Boolean),
    [selected, accounts]
  );
  const selectedProviders = useMemo(
    () => [...new Set(selectedAccounts.map((a) => a.provider))],
    [selectedAccounts]
  );
  const tightestLimit = useMemo(() => {
    if (selectedProviders.length === 0) return null;
    return Math.min(...selectedProviders.map((p) => PROVIDERS[p].capabilities.maxCaptionLength));
  }, [selectedProviders]);

  const publishBlockReason = useMemo(() => {
    if (selected.length === 0) return "Select at least one destination";
    if (caption.trim() === "" && mediaIds.length === 0) return "Add a caption or media first";
    if (errors.length > 0) return `Fix ${errors.length} issue${errors.length === 1 ? "" : "s"} to publish`;
    return null;
  }, [selected.length, caption, mediaIds.length, errors.length]);

  /* ------------------------------- mutations ------------------------------ */

  const setVariant = useCallback((provider: ProviderId, patch: Partial<VariantOverride>) => {
    setVariants((prev) => {
      const existing = prev.find((v) => v.provider === provider);
      if (existing) {
        return prev.map((v) =>
          v.provider === provider ? { ...v, ...patch, settings: { ...v.settings, ...(patch.settings ?? {}) } } : v
        );
      }
      return [...prev, { provider, caption: undefined, title: undefined, firstComment: undefined, settings: {}, ...patch } as VariantOverride];
    });
  }, []);

  const resetVariant = (provider: ProviderId) => {
    setVariants((prev) => prev.filter((v) => v.provider !== provider));
    toast({ title: `${PROVIDERS[provider].name} reset to the universal version`, variant: "info" });
  };

  const addFiles = useCallback(
    async (files: File[]) => {
      for (const file of files) {
        const key = `${file.name}-${Date.now()}`;
        setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
        try {
          const asset = await mediaService.upload(file, (pct) =>
            setUploads((u) => u.map((t) => (t.key === key ? { ...t, pct } : t)))
          );
          setMediaIds((ids) => [...ids, asset.id]);
          setMediaList(mediaService.list());
        } catch {
          toast({ title: `Could not process ${file.name}`, description: "The file may be malformed.", variant: "error" });
        }
        setUploads((u) => u.filter((t) => t.key !== key));
      }
    },
    [toast]
  );

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []);
      if (files.length > 0) {
        e.preventDefault();
        void addFiles(files);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [addFiles]);

  const applyFix = async (issue: CompatIssue) => {
    const fix = issue.fix;
    if (!fix) return;
    setFixing(issue.id);
    try {
      switch (fix.kind) {
        case "trim_caption": {
          setVariant(fix.provider, { caption: caption.slice(0, fix.targetLength) });
          toast({
            title: `${PROVIDERS[fix.provider].name} caption trimmed to ${fix.targetLength}`,
            description: "Saved as a platform override — the universal caption is untouched.",
            variant: "success",
          });
          break;
        }
        case "crop_media":
        case "compress_media":
        case "trim_video": {
          const derived = await mediaService.derive(fix.mediaId, {
            aspect: fix.kind === "crop_media" ? fix.aspect : undefined,
            scaleBytesTo:
              fix.kind === "compress_media"
                ? Math.round((mediaList.find((m) => m.id === fix.mediaId)?.bytes ?? 0) * 0.4)
                : undefined,
            trimToSec: fix.kind === "trim_video" ? fix.toSec : undefined,
            note: fix.kind === "compress_media" ? "compressed" : undefined,
          });
          setMediaIds((ids) => ids.map((id) => (id === fix.mediaId ? derived.id : id)));
          setMediaList(mediaService.list());
          toast({
            title: "Derivative created",
            description: `“${derived.filename}” replaces the original in this post. The original stays in your library.`,
            variant: "success",
          });
          break;
        }
        case "open_variant":
          setCustomize(true);
          setActiveVariant(fix.provider);
          break;
        case "reconnect":
          await accountsService.reconnect(fix.accountId);
          toast({ title: "Account reconnected", description: "You can publish to it again.", variant: "success" });
          break;
      }
    } finally {
      setFixing(null);
    }
  };

  const aiAdapt = () => {
    if (selectedProviders.length === 0 || !caption.trim()) {
      toast({ title: "Write a caption first", description: "The adapter rewrites your universal caption per network.", variant: "warning" });
      return;
    }
    selectedProviders.forEach((p) => setVariant(p, { caption: adaptCaption(p, caption) }));
    if (selectedProviders.includes("youtube")) {
      setVariant("youtube", { title: title || caption.split("\n")[0].slice(0, 90) });
    }
    setAiDisclosed(true);
    setCustomize(true);
    toast({
      title: `Adapted for ${selectedProviders.length} networks`,
      description: "Review each variant in “Customize by platform” — nothing is changed without your approval.",
      variant: "success",
    });
  };

  const buildInput = () => ({
    title: title.trim() || caption.slice(0, 60) || "Untitled post",
    caption,
    link: link || undefined,
    mediaIds,
    selectedAccountIds: selected,
    brandId: session?.brandId ?? "brand_aria",
    campaign: campaign || undefined,
    labels,
    aiDisclosed,
    variants,
  });

  const saveDraft = async () => {
    setSaving(true);
    try {
      if (editId) {
        await postsService.updateDraft(editId, buildInput());
        toast({ title: "Draft updated", variant: "success" });
      } else {
        await postsService.createDraft(buildInput());
        toast({ title: "Draft saved", description: "Find it under Posts → Drafts.", variant: "success" });
      }
      router.push("/posts?tab=drafts");
    } finally {
      setSaving(false);
    }
  };

  const publishNow = async () => {
    setPublishing(true);
    try {
      let id = editId;
      if (id) {
        await postsService.updateDraft(id, buildInput());
      } else {
        id = (await postsService.createDraft(buildInput())).id;
      }
      await postsService.publish(id);
      toast({
        title: `Publishing to ${selected.length} destination${selected.length === 1 ? "" : "s"}…`,
        description: "Each network delivers independently. You can watch live.",
        variant: "info",
      });
      router.push(`/posts/${id}`);
    } finally {
      setPublishing(false);
    }
  };

  const schedule = async (iso: string) => {
    setScheduleOpen(false);
    setPublishing(true);
    try {
      let id = editId;
      if (id) {
        await postsService.updateDraft(id, buildInput());
      } else {
        id = (await postsService.createDraft(buildInput())).id;
      }
      await postsService.schedule(id, iso);
      toast({ title: "Scheduled", description: `Will publish on ${new Date(iso).toLocaleString()}.`, variant: "success" });
      router.push(`/posts/${id}`);
    } finally {
      setPublishing(false);
    }
  };

  const insertAtCursor = (text: string) => {
    const el = captionRef.current;
    if (!el) {
      setCaption((c) => c + text);
      return;
    }
    const start = el.selectionStart ?? caption.length;
    const end = el.selectionEnd ?? caption.length;
    setCaption(caption.slice(0, start) + text + caption.slice(end));
    requestAnimationFrame(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + text.length;
    });
  };

  /* -------------------------------- render -------------------------------- */

  const activeVariantObj = activeVariant ? variants.find((v) => v.provider === activeVariant) : undefined;
  const effectivePreviewProvider =
    previewProvider && selectedProviders.includes(previewProvider)
      ? previewProvider
      : selectedProviders[0];

  // Keep the preview switched to a valid selected network.
  useEffect(() => {
    if (effectivePreviewProvider) setPreviewProvider(effectivePreviewProvider);
  }, [effectivePreviewProvider]);

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Create post" />
        <PageBody>
          <div className="grid gap-4 lg:grid-cols-[250px_minmax(0,1fr)_330px]">
            <Skeleton className="h-96 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
            <Skeleton className="h-96 rounded-xl" />
          </div>
        </PageBody>
      </div>
    );
  }

  const isCustomized = (p: ProviderId) => {
    const v = variants.find((x) => x.provider === p);
    return !!(v && (v.caption || v.title || v.firstComment || Object.keys(v.settings).length > 0));
  };

  const issueIcon = (sev: CompatIssue["severity"]) =>
    sev === "error" ? (
      <CircleAlert className="size-4 shrink-0 text-danger" aria-hidden />
    ) : sev === "warning" ? (
      <CircleAlert className="size-4 shrink-0 text-warn" aria-hidden />
    ) : (
      <Info className="size-4 shrink-0 text-info" aria-hidden />
    );

  return (
    <div>
      <PageHeader
        title={editId ? "Edit draft" : "Create post"}
        description="Compose once, target every network, and let the compatibility engine catch problems before they happen."
        actions={
          <Link href="/posts" className="text-[13px] font-medium text-ink-2 hover:text-ink">
            <ArrowLeft className="mr-1 inline size-3.5" />
            Back to posts
          </Link>
        }
      />

      <PageBody className="pb-40 lg:pb-28">
        <div className="grid items-start gap-4 lg:grid-cols-[250px_minmax(0,1fr)_340px]">
          {/* Destinations */}
          <Card className="p-3 lg:sticky lg:top-20 lg:max-h-[calc(100dvh-10rem)] lg:overflow-y-auto">
            <DestinationPanel
              accounts={accounts}
              selected={selected}
              onToggle={(id) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))}
              onSelectGroup={(ids) => setSelected((s) => [...new Set([...s, ...ids])])}
              onClear={() => setSelected([])}
              onConnect={() => setConnectOpen(true)}
            />
          </Card>

          {/* Editor */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card className="p-4">
              <Field label="Internal title" htmlFor="post-title" hint="Never published — helps your team find this post.">
                <Input
                  id="post-title"
                  placeholder="e.g. Launch film — main announcement"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </Field>

              <div className="mt-4">
                <Field label="Caption" htmlFor="caption">
                  <Textarea
                    id="caption"
                    ref={captionRef}
                    rows={7}
                    placeholder="What do you want to tell the world?"
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    onBlur={(e) => setEmojiAnchor(e.target.selectionStart)}
                    className="text-[15px]"
                  />
                </Field>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Popover
                    align="start"
                    width="w-56"
                    trigger={({ toggle }) => (
                      <Button variant="ghost" size="sm" onClick={toggle}>
                        <SmilePlus className="size-4" /> Emoji
                      </Button>
                    )}
                  >
                    <div className="grid grid-cols-8 gap-1 p-2">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => {
                            if (emojiAnchor !== null) {
                              setCaption((c) => c.slice(0, emojiAnchor) + e + c.slice(emojiAnchor));
                            } else insertAtCursor(e);
                          }}
                          className="rounded-md p-1 text-lg hover:bg-surface-2"
                          aria-label={`Insert ${e}`}
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  </Popover>

                  <Popover
                    align="start"
                    width="w-60"
                    trigger={({ toggle }) => (
                      <Button variant="ghost" size="sm" onClick={toggle}>
                        <Hash className="size-4" /> Hashtags
                      </Button>
                    )}
                  >
                    <div className="p-2">
                      <p className="px-1 pb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-3">Suggested for your audience</p>
                      <div className="flex flex-wrap gap-1.5">
                        {HASHTAGS.map((h) => (
                          <button
                            key={h}
                            onClick={() => insertAtCursor(` ${h}`)}
                            className="rounded-full border px-2 py-0.5 text-[12px] font-medium text-accent-ink hover:bg-accent-soft"
                          >
                            {h}
                          </button>
                        ))}
                      </div>
                    </div>
                  </Popover>

                  <Tooltip label="Rewrite the caption for each network">
                    <Button variant="ghost" size="sm" onClick={aiAdapt}>
                      <Wand2 className="size-4" /> Adapt per network
                    </Button>
                  </Tooltip>

                  <span className="ml-auto text-[12px]">
                    <span className={cn("tnum font-semibold", tightestLimit && caption.length > tightestLimit ? "text-danger" : "text-ink-2")}>
                      {caption.length.toLocaleString()}
                    </span>
                    {tightestLimit !== null && (
                      <span className="text-ink-3"> / {tightestLimit.toLocaleString()} (tightest: {PROVIDERS[selectedProviders.find((p) => PROVIDERS[p].capabilities.maxCaptionLength === tightestLimit) ?? "x"]?.name})</span>
                    )}
                  </span>
                </div>
                {aiDisclosed && (
                  <Checkbox
                    checked={aiDisclosed}
                    onChange={setAiDisclosed}
                    className="mt-2 text-[12px] text-ink-2"
                    label="Disclose AI assistance where networks support it (labels content as AI-assisted)"
                  />
                )}
              </div>
            </Card>

            {/* Media */}
            <Card className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-[13px] font-semibold">Media</p>
                <span className="text-[12px] text-ink-3">Originals are never modified — fixes create copies</span>
              </div>

              <div
                role="button"
                tabIndex={0}
                aria-label="Upload media: click, drag files here, or paste from clipboard"
                onClick={() => document.getElementById("composer-file")?.click()}
                onKeyDown={(e) => e.key === "Enter" && document.getElementById("composer-file")?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  void addFiles(Array.from(e.dataTransfer.files));
                }}
                className={cn(
                  "mt-3 flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-7 text-center transition-colors",
                  dragOver ? "border-accent bg-accent-soft/50" : "border-line-strong hover:border-ink-3/50 hover:bg-surface-2"
                )}
              >
                <Upload className="size-5 text-ink-3" aria-hidden />
                <p className="mt-2 text-[13px] font-medium">
                  Drop images or video here, paste from clipboard, or <span className="text-accent-ink">browse</span>
                </p>
                <p className="mt-0.5 text-[12px] text-ink-3">JPG, PNG, WebP, MP4, MOV — up to 10 GB</p>
                <input
                  id="composer-file"
                  type="file"
                  multiple
                  accept="image/*,video/*,.pdf"
                  className="sr-only"
                  onChange={(e) => {
                    void addFiles(Array.from(e.target.files ?? []));
                    e.target.value = "";
                  }}
                />
              </div>

              {(uploads.length > 0 || media.length > 0) && (
                <div className="mt-3 grid grid-cols-2 gap-2.5 sm:grid-cols-3 md:grid-cols-4">
                  {media.map((m) => (
                    <div key={m.id} className="group relative">
                      <button
                        className="block w-full text-left"
                        onClick={() => setDetailMedia(m)}
                        aria-label={`Open details for ${m.filename}`}
                      >
                        <MediaThumb asset={m} className="aspect-square w-full" />
                        <p className="mt-1 truncate text-[11px] text-ink-3">{m.filename}</p>
                      </button>
                      <button
                        onClick={() => setMediaIds((ids) => ids.filter((id) => id !== m.id))}
                        className="absolute right-1.5 top-1.5 rounded-md bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Remove ${m.filename} from post`}
                      >
                        <X className="size-3" />
                      </button>
                      {!m.altText && m.kind === "image" && (
                        <span className="absolute left-1.5 bottom-6 rounded bg-warn-soft px-1.5 py-0.5 text-[10px] font-semibold text-warn-ink">
                          alt text missing
                        </span>
                      )}
                    </div>
                  ))}
                  {uploads.map((t) => (
                    <div key={t.key} className="flex flex-col justify-center rounded-lg border bg-surface-2 p-3">
                      <p className="truncate text-[11px] font-medium">{t.name}</p>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-line">
                        <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${t.pct}%` }} />
                      </div>
                      <p className="tnum mt-1 text-[10px] text-ink-3">Uploading… {t.pct}%</p>
                    </div>
                  ))}
                </div>
              )}
            </Card>

            {/* Meta */}
            <Card className="p-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Campaign" htmlFor="campaign">
                  <Select id="campaign" value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                    {CAMPAIGNS.map((c) => (
                      <option key={c} value={c}>{c === "" ? "No campaign" : c}</option>
                    ))}
                  </Select>
                </Field>
                <Field label="Labels" htmlFor="labels" hint="Press Enter to add.">
                  <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-line-strong bg-surface px-2 py-1.5">
                    {labels.map((l) => (
                      <span key={l} className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[12px] font-medium text-accent-ink">
                        {l}
                        <button onClick={() => setLabels((ls) => ls.filter((x) => x !== l))} aria-label={`Remove label ${l}`}>
                          <X className="size-3" />
                        </button>
                      </span>
                    ))}
                    <input
                      id="labels"
                      value={labelInput}
                      onChange={(e) => setLabelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && labelInput.trim()) {
                          e.preventDefault();
                          setLabels((ls) => [...new Set([...ls, labelInput.trim()])]);
                          setLabelInput("");
                        }
                      }}
                      placeholder={labels.length === 0 ? "hero, video…" : ""}
                      className="h-6 min-w-20 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-3"
                    />
                  </div>
                </Field>
              </div>

              <button
                onClick={() => setLinkOpen((o) => !o)}
                className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-ink hover:underline"
              >
                <Link2 className="size-3.5" /> {linkOpen ? "Remove link" : "Attach a link"}
              </button>
              {linkOpen && (
                <Input
                  className="mt-2"
                  type="url"
                  placeholder="https://…"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                />
              )}
            </Card>

            {/* Platform customization */}
            <Card>
              <CardHeader
                title={
                  <span className="flex items-center gap-2.5">
                    Customize by platform
                    <Switch checked={customize} onChange={setCustomize} label="Customize by platform" />
                  </span>
                }
                description={
                  customize
                    ? "Overrides inherit from the universal caption until you change them."
                    : "All selected networks will publish the universal caption."
                }
              />
              {customize && (
                <div className="p-4">
                  {selectedProviders.length === 0 ? (
                    <p className="rounded-lg border border-dashed p-4 text-center text-[13px] text-ink-3">
                      Select destinations first, then tailor each network here.
                    </p>
                  ) : (
                    <>
                      <div role="tablist" className="flex flex-wrap gap-1.5">
                        {selectedProviders.map((p) => (
                          <button
                            key={p}
                            role="tab"
                            aria-selected={activeVariant === p}
                            onClick={() => setActiveVariant(p)}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
                              activeVariant === p ? "border-accent bg-accent-soft text-accent-ink" : "bg-surface text-ink-2 hover:border-line-strong"
                            )}
                          >
                            <ProviderBadge provider={p} size="xs" />
                            {PROVIDERS[p].name}
                            {isCustomized(p) && <span className="size-1.5 rounded-full bg-warn" aria-label="Customized" />}
                          </button>
                        ))}
                      </div>

                      {activeVariant && (
                        <div className="mt-4 rounded-xl border bg-surface-2 p-4">
                          <div className="flex items-center justify-between">
                            <p className="text-[13px] font-semibold">
                              {PROVIDERS[activeVariant].name} version
                              {isCustomized(activeVariant) && (
                                <span className="ml-2 rounded-full bg-warn-soft px-2 py-0.5 text-[11px] font-semibold text-warn-ink">Customized</span>
                              )}
                            </p>
                            {isCustomized(activeVariant) && (
                              <Button variant="ghost" size="sm" onClick={() => resetVariant(activeVariant)}>
                                <RotateCcw className="size-3.5" /> Reset to universal
                              </Button>
                            )}
                          </div>

                          <Field
                            className="mt-3"
                            label="Caption override"
                            htmlFor={`vc-${activeVariant}`}
                            hint={
                              activeVariantObj?.caption
                                ? `${activeVariantObj.caption.length} characters`
                                : `Currently inheriting the universal caption (${caption.length} characters).`
                            }
                          >
                            <Textarea
                              id={`vc-${activeVariant}`}
                              rows={4}
                              placeholder={caption || "Universal caption…"}
                              value={activeVariantObj?.caption ?? ""}
                              onChange={(e) => setVariant(activeVariant, { caption: e.target.value })}
                            />
                          </Field>

                          {activeVariant === "youtube" && (
                            <div className="mt-3 grid gap-3 sm:grid-cols-2">
                              <Field label="Video title (required)" htmlFor="yt-title" error={!activeVariantObj?.title ? "YouTube requires a title" : undefined}>
                                <Input
                                  id="yt-title"
                                  maxLength={100}
                                  value={activeVariantObj?.title ?? ""}
                                  onChange={(e) => setVariant("youtube", { title: e.target.value })}
                                  placeholder="Introducing the new Aria Hub (2-minute tour)"
                                />
                              </Field>
                              <Field label="Visibility" htmlFor="yt-vis">
                                <Select
                                  id="yt-vis"
                                  value={activeVariantObj?.settings.visibility ?? ""}
                                  onChange={(e) => setVariant("youtube", { settings: { visibility: (e.target.value || undefined) as VariantOverride["settings"]["visibility"] } })}
                                >
                                  <option value="">Choose…</option>
                                  <option value="public">Public</option>
                                  <option value="unlisted">Unlisted</option>
                                  <option value="private">Private</option>
                                </Select>
                              </Field>
                              <Field label="Category" htmlFor="yt-cat">
                                <Select
                                  id="yt-cat"
                                  value={activeVariantObj?.settings.category ?? ""}
                                  onChange={(e) => setVariant("youtube", { settings: { category: e.target.value || undefined } })}
                                >
                                  <option value="">Default</option>
                                  {YT_CATEGORIES.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                  ))}
                                </Select>
                              </Field>
                              <div className="flex items-end pb-1">
                                <Checkbox
                                  checked={activeVariantObj?.settings.madeForKids ?? false}
                                  onChange={(v) => setVariant("youtube", { settings: { madeForKids: v } })}
                                  label="Made for kids"
                                />
                              </div>
                            </div>
                          )}

                          {activeVariant === "tiktok" && (
                            <div className="mt-3 flex flex-col gap-3">
                              <div>
                                <p className="text-[13px] font-medium">Who can view this post?</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {(["public", "followers", "private"] as const).map((opt) => (
                                    <button
                                      key={opt}
                                      onClick={() => setVariant("tiktok", { settings: { privacyOption: opt } })}
                                      className={cn(
                                        "rounded-full border px-3 py-1 text-[13px] font-medium capitalize",
                                        activeVariantObj?.settings.privacyOption === opt
                                          ? "border-accent bg-accent-soft text-accent-ink"
                                          : "bg-surface text-ink-2 hover:border-line-strong"
                                      )}
                                    >
                                      {opt === "public" ? "Everyone" : opt === "followers" ? "Followers" : "Only me"}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <Checkbox
                                checked={activeVariantObj?.settings.allowComments ?? true}
                                onChange={(v) => setVariant("tiktok", { settings: { allowComments: v } })}
                                label="Allow comments"
                              />
                            </div>
                          )}

                          {activeVariant === "pinterest" && (
                            <Field className="mt-3" label="Board (required)" htmlFor="pin-board">
                              <Select
                                id="pin-board"
                                value={activeVariantObj?.settings.boardId ?? ""}
                                onChange={(e) => setVariant("pinterest", { settings: { boardId: e.target.value || undefined } })}
                              >
                                <option value="">Choose a board…</option>
                                {PINTEREST_BOARDS.map((b) => (
                                  <option key={b.id} value={b.label}>{b.label}</option>
                                ))}
                              </Select>
                            </Field>
                          )}

                          {(activeVariant === "linkedin" || activeVariant === "facebook") && (
                            <Field
                              className="mt-3"
                              label="First comment"
                              htmlFor={`fc-${activeVariant}`}
                              hint="Published as a comment right after the post goes live."
                            >
                              <Input
                                id={`fc-${activeVariant}`}
                                value={activeVariantObj?.firstComment ?? ""}
                                onChange={(e) => setVariant(activeVariant, { firstComment: e.target.value })}
                                placeholder="Optional — e.g. drop your questions below 👇"
                              />
                            </Field>
                          )}

                          {activeVariant === "instagram" && (
                            <Field
                              className="mt-3"
                              label="Alt text"
                              htmlFor="ig-alt"
                              hint="Applied to the first image for screen readers."
                            >
                              <Input
                                id="ig-alt"
                                value={activeVariantObj?.settings.altText ?? ""}
                                onChange={(e) => setVariant("instagram", { settings: { altText: e.target.value || undefined } })}
                                placeholder="Describe the image for people who can't see it"
                              />
                            </Field>
                          )}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </Card>
          </div>

          {/* Right: validation + preview */}
          <div className="flex min-w-0 flex-col gap-4">
            <Card>
              <CardHeader
                title="Compatibility check"
                description={
                  selected.length === 0
                    ? "Select destinations to validate against their rules."
                    : `${selected.length} destination${selected.length === 1 ? "" : "s"} · ${errors.length} error${errors.length === 1 ? "" : "s"}, ${warnings.length} warning${warnings.length === 1 ? "" : "s"}`
                }
              />
              <div className="flex flex-col">
                {selected.length > 0 && issues.length === 0 && (
                  <p className="flex items-center gap-2 px-5 py-4 text-[13px] font-medium text-success-ink">
                    <Sparkles className="size-4" /> Every destination is ready to publish.
                  </p>
                )}
                {issues.map((issue) => (
                  <div key={issue.id} className={cn("flex items-start gap-2.5 border-t px-4 py-3", issue.severity === "tip" && "bg-surface-2/60")}>
                    {issueIcon(issue.severity)}
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-semibold leading-snug">{issue.title}</p>
                      <p className="mt-0.5 text-[12.5px] leading-snug text-ink-2">{issue.message}</p>
                      {issue.fix && (
                        <Button
                          size="sm"
                          variant={issue.severity === "error" ? "soft" : "secondary"}
                          className="mt-2"
                          loading={fixing === issue.id}
                          onClick={() => void applyFix(issue)}
                        >
                          {issue.fix.label}
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="p-4">
              {selectedProviders.length === 0 ? (
                <p className="py-8 text-center text-[13px] text-ink-3">
                  Previews appear here once you select destinations.
                </p>
              ) : (
                <>
                  <div role="tablist" aria-label="Preview network" className="mb-3 flex flex-wrap gap-1.5">
                    {selectedProviders.map((p) => (
                      <button
                        key={p}
                        role="tab"
                        aria-selected={previewProvider === p}
                        onClick={() => setPreviewProvider(p)}
                        className={cn(
                          "rounded-full border p-1 transition-colors",
                          previewProvider === p ? "border-accent bg-accent-soft" : "border-line hover:border-line-strong"
                        )}
                        aria-label={`Preview ${PROVIDERS[p].name}`}
                      >
                        <ProviderBadge provider={p} size="sm" />
                      </button>
                    ))}
                  </div>
                  <NetworkPreview
                    provider={effectivePreviewProvider}
                    caption={variants.find((v) => v.provider === effectivePreviewProvider)?.caption ?? caption}
                    media={media}
                    accountName={selectedAccounts.find((a) => a.provider === effectivePreviewProvider)?.displayName ?? "ARIA HUB"}
                    accountHandle={selectedAccounts.find((a) => a.provider === effectivePreviewProvider)?.handle ?? "@myariahub"}
                    avatarHue={selectedAccounts.find((a) => a.provider === effectivePreviewProvider)?.avatarHue ?? 162}
                    variant={variants.find((v) => v.provider === previewProvider)}
                  />
                  <p className="mt-2.5 text-center text-[11px] text-ink-3">
                    Approximate preview — caption truncation and cropping shown where the network applies them.
                  </p>
                </>
              )}
            </Card>
          </div>
        </div>
      </PageBody>

      {/* Action bar */}
      <div className="sticky bottom-[64px] z-30 border-t bg-surface/92 px-4 py-3 backdrop-blur-md lg:bottom-0 lg:px-8">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {publishBlockReason ? (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-danger">
                <CircleAlert className="size-4" /> {publishBlockReason}
              </p>
            ) : (
              <p className="flex items-center gap-1.5 text-[13px] font-medium text-success-ink">
                <Sparkles className="size-4" /> Ready for {selected.length} destination{selected.length === 1 ? "" : "s"}
                {warnings.length > 0 && <span className="text-warn-ink">· {warnings.length} warning{warnings.length === 1 ? "" : "s"}</span>}
              </p>
            )}
          </div>
          <Button variant="secondary" onClick={saveDraft} loading={saving} disabled={!caption && mediaIds.length === 0}>
            Save draft
          </Button>
          <Button variant="secondary" onClick={() => setScheduleOpen(true)} disabled={!!publishBlockReason}>
            Schedule
          </Button>
          {DATA_MODE === "api" && (
            <Button
              variant="secondary"
              onClick={async () => {
                setPublishing(true);
                try {
                  let id = editId;
                  if (id) {
                    await postsService.updateDraft(id, buildInput());
                  } else {
                    id = (await postsService.createDraft(buildInput())).id;
                  }
                  const data = await apiPost<{ scheduledAt: string }>(
                    `/v1/workspaces/current/posts/${id}/add-to-queue`
                  );
                  toast({
                    title: "Added to queue",
                    description: `Publishes ${new Date(data.scheduledAt).toLocaleString()}`,
                    variant: "success",
                  });
                  router.push(`/posts/${id}`);
                } catch (err) {
                  toast({ title: "Could not queue", description: (err as Error).message, variant: "error" });
                } finally {
                  setPublishing(false);
                }
              }}
              disabled={!!publishBlockReason || publishing}
            >
              Add to queue
            </Button>
          )}
          <Button onClick={publishNow} loading={publishing} disabled={!!publishBlockReason}>
            <Upload className="size-4" />
            Publish everywhere{selected.length > 0 ? ` (${selected.length})` : ""}
          </Button>
        </div>
      </div>

      {/* Media detail dialog */}
      <Dialog
        open={!!detailMedia}
        onClose={() => setDetailMedia(null)}
        title={detailMedia?.filename ?? ""}
        width="md"
        footer={
          <>
            <Button
              variant="danger-ghost"
              onClick={() => {
                if (detailMedia) setMediaIds((ids) => ids.filter((id) => id !== detailMedia.id));
                setDetailMedia(null);
              }}
            >
              <Trash2 className="size-4" /> Remove from post
            </Button>
            <Button variant="secondary" onClick={() => setDetailMedia(null)}>Close</Button>
          </>
        }
      >
        {detailMedia && (
          <div className="flex flex-col gap-4 sm:flex-row">
            <MediaThumb asset={detailMedia} className="aspect-square w-full max-w-[200px] shrink-0" />
            <div className="min-w-0 flex-1">
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[13px]">
                <dt className="text-ink-3">Type</dt>
                <dd className="font-medium">{detailMedia.kind} · {detailMedia.mime}</dd>
                {detailMedia.width && (
                  <>
                    <dt className="text-ink-3">Dimensions</dt>
                    <dd className="tnum font-medium">{detailMedia.width}×{detailMedia.height} ({detailMedia.aspectRatio})</dd>
                  </>
                )}
                {detailMedia.durationSec !== undefined && (
                  <>
                    <dt className="text-ink-3">Duration</dt>
                    <dd className="tnum font-medium">{formatDuration(detailMedia.durationSec)}</dd>
                  </>
                )}
                {detailMedia.codec && (
                  <>
                    <dt className="text-ink-3">Codec</dt>
                    <dd className="font-medium">{detailMedia.codec}{detailMedia.audioCodec ? ` + ${detailMedia.audioCodec}` : ""}</dd>
                  </>
                )}
                <dt className="text-ink-3">Size</dt>
                <dd className="tnum font-medium">{formatBytes(detailMedia.bytes)}</dd>
                <dt className="text-ink-3">Checksum</dt>
                <dd className="truncate font-mono text-[11px]">{detailMedia.checksum}</dd>
              </dl>
              <Field
                className="mt-4"
                label="Alt text"
                htmlFor="alt"
                hint="Read aloud by screen readers. Recommended for every image."
              >
                <Input
                  id="alt"
                  value={detailMedia.altText ?? ""}
                  onChange={(e) => {
                    const val = e.target.value;
                    setDetailMedia((d) => (d ? { ...d, altText: val } : d));
                  }}
                  onBlur={() => {
                    if (detailMedia) void mediaService.update(detailMedia.id, { altText: detailMedia.altText });
                  }}
                  placeholder="Describe this image"
                />
              </Field>
            </div>
          </div>
        )}
      </Dialog>

      <ScheduleDialog
        open={scheduleOpen}
        onClose={() => setScheduleOpen(false)}
        onConfirm={schedule}
        workspaceTimezone={session?.workspace.timezone ?? "Europe/Berlin"}
      />
      <ConnectFlow open={connectOpen} onClose={() => setConnectOpen(false)} brandId={session?.brandId ?? "brand_aria"} />
    </div>
  );
}

export default function ComposerPage() {
  return (
    <Suspense fallback={
      <div>
        <PageHeader title="Create post" />
        <PageBody>
          <Skeleton className="h-96 rounded-xl" />
        </PageBody>
      </div>
    }>
      <ComposerInner />
    </Suspense>
  );
}
