"use client";

import { useEffect, useMemo, useState } from "react";
import { Copy, FileText, Film, ImageIcon, LayoutGrid, List, Plus, Search, Trash2, Upload } from "lucide-react";
import type { MediaAsset, MediaKind } from "@/lib/types";
import { mediaService } from "@/lib/services/media";
import { useSubscribe } from "@/lib/services/hooks";
import { useToast } from "@/components/providers";
import { PageHeader, PageBody } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Card, EmptyState, Field, Input, Progress, Segmented, Select, Skeleton, Textarea } from "@/components/ui/primitives";
import { ConfirmDialog, Drawer } from "@/components/ui/dialog";
import { MediaThumb } from "@/components/ui/media-thumb";
import { cn, formatBytes, formatDateTime, formatDuration } from "@/lib/utils";

type KindFilter = "all" | MediaKind;

export default function ContentPage() {
  useSubscribe(mediaService);
  const toast = useToast();
  const [loaded, setLoaded] = useState(false);
  const [assets, setAssets] = useState<MediaAsset[]>([]);
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");
  const [tag, setTag] = useState("all");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const [detail, setDetail] = useState<MediaAsset | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<MediaAsset | null>(null);
  const [uploads, setUploads] = useState<{ key: string; name: string; pct: number }[]>([]);
  const [altDraft, setAltDraft] = useState("");

  useEffect(() => {
    const read = () => {
      setAssets(mediaService.list());
      setLoaded(true);
    };
    mediaService.listAsync().then(read);
    return mediaService.subscribe(read);
  }, []);

  const tags = useMemo(() => [...new Set(assets.flatMap((a) => a.tags))], [assets]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return assets
      .filter((a) => kind === "all" || a.kind === kind)
      .filter((a) => tag === "all" || a.tags.includes(tag))
      .filter((a) => !q || a.filename.toLowerCase().includes(q) || (a.altText ?? "").toLowerCase().includes(q));
  }, [assets, query, kind, tag]);

  const uploadFiles = async (files: File[]) => {
    for (const file of files) {
      const key = `${file.name}-${Date.now()}`;
      setUploads((u) => [...u, { key, name: file.name, pct: 0 }]);
      try {
        await mediaService.upload(file, (pct) => setUploads((u) => u.map((t) => (t.key === key ? { ...t, pct } : t))));
        setAssets(mediaService.list());
        toast({ title: `${file.name} uploaded`, description: "Inspected, checksummed and stored.", variant: "success" });
      } catch {
        toast({ title: `Upload failed for ${file.name}`, variant: "error" });
      }
      setUploads((u) => u.filter((t) => t.key !== key));
    }
  };

  const openDetail = (a: MediaAsset) => {
    setDetail(a);
    setAltDraft(a.altText ?? "");
  };

  if (!loaded) {
    return (
      <div>
        <PageHeader title="Content" />
        <PageBody>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
              <Skeleton key={i} className="aspect-square rounded-xl" />
            ))}
          </div>
        </PageBody>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Content"
        description="Your media library. Uploads are inspected, checksummed and deduplicated — originals are never modified."
        actions={
          <>
            <Segmented
              value={layout}
              onChange={setLayout}
              size="sm"
              options={[
                { value: "grid", label: <LayoutGrid className="size-3.5" /> },
                { value: "list", label: <List className="size-3.5" /> },
              ]}
            />
            <label className="inline-flex">
              <Button onClick={() => document.getElementById("content-file")?.click()}>
                <Upload className="size-4" /> Upload
              </Button>
              <input
                id="content-file"
                type="file"
                multiple
                accept="image/*,video/*,.pdf"
                className="sr-only"
                onChange={(e) => {
                  void uploadFiles(Array.from(e.target.files ?? []));
                  e.target.value = "";
                }}
              />
            </label>
          </>
        }
      >
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void uploadFiles(Array.from(e.dataTransfer.files));
          }}
          className="flex flex-wrap items-center gap-3"
        >
          <div className="relative min-w-52 flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and alt text…" className="pl-9" aria-label="Search media" />
          </div>
          <Segmented
            value={kind}
            onChange={setKind}
            size="sm"
            options={[
              { value: "all", label: "All" },
              { value: "image", label: "Images" },
              { value: "video", label: "Video" },
              { value: "document", label: "Docs" },
            ]}
          />
          <Select value={tag} onChange={(e) => setTag(e.target.value)} className="w-36 text-[13px]" aria-label="Filter by tag">
            <option value="all">All tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>#{t}</option>
            ))}
          </Select>
        </div>
      </PageHeader>

      <PageBody>
        {uploads.length > 0 && (
          <div className="mb-4 flex flex-col gap-2 rounded-xl border bg-surface p-4">
            {uploads.map((t) => (
              <div key={t.key}>
                <div className="flex justify-between text-[12px]">
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="tnum text-ink-3">{t.pct}%</span>
                </div>
                <Progress value={t.pct} className="mt-1" />
              </div>
            ))}
          </div>
        )}

        {visible.length === 0 ? (
          <EmptyState
            icon={<ImageIcon className="size-5" />}
            title={query ? `Nothing matches “${query}”` : "Your library is empty"}
            body={query ? "Try a different search." : "Drag files anywhere on this page, or upload from your device. We detect type, dimensions and codec automatically."}
            action={!query ? <Button onClick={() => document.getElementById("content-file")?.click()}>Upload media</Button> : undefined}
          />
        ) : layout === "grid" ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {visible.map((a) => (
              <button key={a.id} onClick={() => openDetail(a)} className="group text-left">
                <MediaThumb asset={a} className="aspect-square w-full transition-transform group-hover:scale-[1.015]" />
                <p className="mt-1.5 truncate text-[13px] font-medium">{a.filename}</p>
                <p className="tnum truncate text-[11px] text-ink-3">
                  {a.kind === "video" && a.durationSec ? `${formatDuration(a.durationSec)} · ` : ""}
                  {formatBytes(a.bytes)}
                  {a.usedInCount > 0 ? ` · used in ${a.usedInCount}` : " · unused"}
                </p>
              </button>
            ))}
          </div>
        ) : (
          <Card className="overflow-hidden">
            <ul className="divide-y">
              {visible.map((a) => (
                <li key={a.id}>
                  <button onClick={() => openDetail(a)} className="flex w-full items-center gap-3.5 px-5 py-3 text-left transition-colors hover:bg-surface-2">
                    <MediaThumb asset={a} showKind={false} showDuration={false} className="size-10 rounded-lg" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{a.filename}</p>
                      <p className="tnum truncate text-[12px] text-ink-3">
                        {a.kind} · {formatBytes(a.bytes)} · {formatDateTime(a.createdAt)}
                        {a.width ? ` · ${a.width}×${a.height}` : ""}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {a.tags.map((t) => (
                        <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">#{t}</span>
                      ))}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </PageBody>

      <Drawer open={!!detail} onClose={() => setDetail(null)} title={detail?.filename ?? ""}>
        {detail && (
          <div className="p-5">
            <div className="flex flex-col gap-5 sm:flex-row">
              <MediaThumb asset={detail} className="aspect-square w-full max-w-[220px] shrink-0" />
              <div className="min-w-0 flex-1">
                <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-[13px]">
                  <dt className="text-ink-3">Type</dt>
                  <dd className="font-medium">{detail.kind} · {detail.detectedMime}</dd>
                  <dt className="text-ink-3">Size</dt>
                  <dd className="tnum font-medium">{formatBytes(detail.bytes)}</dd>
                  {detail.width ? (
                    <>
                      <dt className="text-ink-3">Dimensions</dt>
                      <dd className="tnum font-medium">{detail.width}×{detail.height} ({detail.aspectRatio})</dd>
                    </>
                  ) : null}
                  {detail.durationSec ? (
                    <>
                      <dt className="text-ink-3">Duration</dt>
                      <dd className="tnum font-medium">{formatDuration(detail.durationSec)}</dd>
                      <dt className="text-ink-3">Streams</dt>
                      <dd className="font-medium">{detail.codec} video · {detail.audioCodec} audio · {detail.fps} fps</dd>
                    </>
                  ) : null}
                  <dt className="text-ink-3">Checksum</dt>
                  <dd className="truncate font-mono text-[11px]">{detail.checksum}</dd>
                  <dt className="text-ink-3">Uploaded</dt>
                  <dd className="font-medium">{formatDateTime(detail.createdAt)}</dd>
                  <dt className="text-ink-3">Used in</dt>
                  <dd className="font-medium">{detail.usedInCount} post{detail.usedInCount === 1 ? "" : "s"}</dd>
                </dl>
              </div>
            </div>

            <Field
              className="mt-5"
              label="Alt text"
              htmlFor="lib-alt"
              hint="Describes the media for screen readers and is suggested in the composer."
            >
              <Textarea id="lib-alt" rows={3} value={altDraft} onChange={(e) => setAltDraft(e.target.value)} />
            </Field>

            <div className="mt-5 flex justify-between">
              <Button
                variant="danger-ghost"
                onClick={() => setConfirmDelete(detail)}
              >
                <Trash2 className="size-4" /> Delete from library
              </Button>
              <Button
                onClick={async () => {
                  await mediaService.update(detail.id, { altText: altDraft });
                  setAssets(mediaService.list());
                  setDetail(mediaService.get(detail.id) ?? null);
                  toast({ title: "Alt text saved", variant: "success" });
                }}
              >
                Save alt text
              </Button>
            </div>

            {detail.usedInCount === 0 && (
              <p className="mt-4 flex items-start gap-2 rounded-lg border border-dashed p-3 text-[12.5px] text-ink-3">
                <FileText className="mt-0.5 size-3.5 shrink-0" />
                This asset isn't used by any post yet. Deleting it is safe.
              </p>
            )}
          </div>
        )}
      </Drawer>

      <ConfirmDialog
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        onConfirm={async () => {
          if (confirmDelete) {
            await mediaService.remove(confirmDelete.id);
            setAssets(mediaService.list());
            setDetail(null);
            toast({ title: "Asset deleted", variant: "info" });
          }
          setConfirmDelete(null);
        }}
        title="Delete from library?"
        body={`“${confirmDelete?.filename}” will be removed from storage. Posts that already published keep their copies at the networks; drafts using it will lose it.`}
        confirmLabel="Delete asset"
        danger
      />
    </div>
  );
}
