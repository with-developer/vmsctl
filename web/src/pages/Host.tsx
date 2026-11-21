import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, api } from "../lib/api";
import { type Async, useAsync, useNow } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { ago, compareControls, ctitle, localized } from "../lib/format";
import { lastListAddress } from "../lib/listAddress";
import { Avatar, Await, Empty, Gauge, Inline, ScorePill, Severity, SignedBadge, StatusBadge, StatusBar } from "../components/ui";
import { TrendChart } from "../components/charts";
import { IconChevron, IconDownload, IconSearch } from "../components/icons";
import { STATUSES, type ControlChange, type ControlRow, type Diff, type HostDetail, type ScanDoc, type ScanRow, type Status } from "../lib/types";
import { STALE_DAYS } from "./Overview";

export function HostPage({ id }: { id: number }) {
  const { t } = useI18n();
  // The tab lives here, outside Await, so that a reload (after "scan now") keeps it.
  const [tab, setTab] = useState<Tab>("controls");
  const state = useAsync(() => api.host(id, STALE_DAYS), [id], false);
  return (
    <Await state={state} skeleton={<p className="crumb"><a href={lastListAddress("hosts")}>{t("host.back")}</a></p>}>
      {(h) => <HostBody h={h} id={id} reload={state.reload} tab={tab} setTab={setTab} />}
    </Await>
  );
}

/** How many changes the "since the previous scan" card lists before it points at the comparison. */
const SINCE_MAX = 8;

type Tab = "controls" | "history";

function HostBody({ h, id, reload, tab, setTab }: { h: HostDetail; id: number; reload: () => void; tab: Tab; setTab: (t: Tab) => void }) {
  const { t } = useI18n();
  const now = useNow();
  // A control to open in the list, until the list has opened it; and a pair of scans to compare (n makes every click a new one).
  const [focus, setFocus] = useState<string | null>(null);
  const [compare, setCompare] = useState<{ pair: [number, number]; n: number } | null>(null);
  const [latest, previous] = h.scans;
  const since = useAsync(() => (previous ? api.diff(previous.id, latest.id) : Promise.resolve(null as Diff | null)), [previous?.id, latest?.id], false);
  // The comparison covers the whole scans; the page shows the controls of the chosen profile.
  const sinceHere = useMemo(() => {
    const profiles = new Set(h.controls.map((c) => c.profile));
    const d = since.data;
    const here = (list: ControlChange[]) => list.filter((c) => profiles.has(c.profile));
    return d && { ...d, regressed: here(d.regressed), fixed: here(d.fixed), changed: here(d.changed), added: here(d.added), removed: here(d.removed) };
  }, [h.controls, since.data]);
  const worse = useMemo(() => new Set((sinceHere?.regressed ?? []).map((c) => `${c.profile}/${c.id}`)), [sinceHere]);
  const show = (next: Tab) => {
    setCompare(null);
    setTab(next);
  };
  return (
    <div className="stack">
      <p className="crumb">
        {h.kind === "image" ? <a href={lastListAddress("images")}>{t("host.backImages")}</a> : <a href={lastListAddress("hosts")}>{t("host.back")}</a>}
      </p>
      <header className="card hosthead">
        <Avatar name={h.name} size={52} />
        <div className="hosthead-main">
          <h1>{h.name}</h1>
          <p className="muted small">
            {h.hostId && (
              <>
                {t("host.hostId")}: <span className="mono">{h.hostId}</span> ·{" "}
              </>
            )}
            {h.kind === "image" && (
              <>
                <span className="badge s-WAIVED">{t("host.image")}</span>{" "}
                {h.imageRef && <span className="mono">{h.imageRef}</span>}{" "}
                {h.imageDigest && (
                  <span className="mono" title={h.imageDigest}>
                    {t("host.imageId")} {h.imageDigest.slice(7, 19)}
                  </span>
                )}{" "}
                ·{" "}
              </>
            )}
            {t("host.lastScan")}: {ago(h.lastScanAt, now, t)} {h.stale && <span className="badge s-MANUAL">{t("stale")}</span>} {h.signed && <SignedBadge fingerprint={h.keyFingerprint} />}
          </p>
          <StatusBar counts={h.counts} legend />
        </div>
        <Gauge score={h.score} label={t("host.passRate")} />
      </header>
      {h.kind !== "image" && <ScanNow hostId={id} onDone={reload} />}
      {(h.packs?.length ?? 0) > 0 && (
        <p className="muted small packs">
          {t("host.packs")}:{" "}
          {h.packs?.map((p) => (
            <span key={`${p.name}/${p.version}/${p.digest}`} className="chip-label" title={p.digest}>
              {p.name} {p.version} <span className="mono">{(p.digest ?? "").slice(0, 19)}</span>
            </span>
          ))}
        </p>
      )}
      {h.otherProfile ? <p className="muted small">{t("profile.hostOther", { profiles: (h.profiles ?? []).join(", ") })}</p> : null}
      {previous && (
        <SinceLast
          diff={{ ...since, data: sinceHere }}
          previous={previous}
          onOpen={(key) => {
            show("controls");
            setFocus(key);
          }}
          onCompare={() => {
            setTab("history");
            setCompare({ pair: [previous.id, latest.id], n: Date.now() });
          }}
        />
      )}

      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={tab === "controls"} className={tab === "controls" ? "on" : ""} onClick={() => show("controls")}>
          {t("host.tabControls")} <span className="count">{h.controls.length}</span>
        </button>
        <button role="tab" aria-selected={tab === "history"} className={tab === "history" ? "on" : ""} onClick={() => show("history")}>
          {t("host.tabHistory")} <span className="count">{h.scans.length}</span>
        </button>
      </div>

      {tab === "controls" ? <Controls controls={h.controls} scanId={h.latestScan} worse={worse} focus={focus} onFocused={() => setFocus(null)} /> : <History key={compare?.n ?? 0} scans={h.scans} initial={compare?.pair ?? null} />}
    </div>
  );
}

/** What changed between the host's previous scan and its latest one: the controls that got worse or were fixed. */
function SinceLast({ diff, previous, onOpen, onCompare }: { diff: Async<Diff | null>; previous: ScanRow; onOpen: (key: string) => void; onCompare: () => void }) {
  const { t, lang } = useI18n();
  const now = useNow();
  if (diff.error) return null; // the history still compares the scans and says what went wrong
  const d = diff.data;
  const items = d ? [...d.regressed.map((c) => ({ c, kind: "regressed" as const })), ...d.fixed.map((c) => ({ c, kind: "fixed" as const }))] : [];
  const more = d ? d.changed.length + d.added.length + d.removed.length + Math.max(0, items.length - SINCE_MAX) : 0;
  // Nothing got worse or was fixed because the two scans checked other controls (another profile, a new revision): say so.
  const other = d ? d.added.length + d.removed.length : 0;
  return (
    <section className="card">
      <div className="titlebar">
        <div>
          <h2>{t("since.title")}</h2>
          <p className="muted small">{t("since.help", { prev: t("host.scan", { id: previous.id }), ago: ago(previous.receivedAt, now, t) })}</p>
        </div>
        <button className="compact" onClick={onCompare}>
          {t("since.compare")}
        </button>
      </div>
      {!d ? (
        <p className="muted">{t("loading")}</p>
      ) : items.length === 0 ? (
        <p className="muted small">{t(other > 0 ? "since.other" : "since.none")}</p>
      ) : (
        <ul className="changes">
          {items.slice(0, SINCE_MAX).map(({ c, kind }) => (
            <li key={`${kind}/${c.profile}/${c.id}`}>
              <span className={`kind kind-${kind}`}>{t(`change.${kind}`)}</span>
              <span className="changes-what">
                <button className="linkbutton" onClick={() => onOpen(`${c.profile}/${c.id}`)}>
                  <span className="mono id">{c.id}</span> {ctitle(c, lang)}
                </button>
              </span>
              <span className="since-status">
                {c.old === c.new ? (
                  <>
                    <StatusBadge status={c.new} /> <span className="muted small">{t("diff.checksChanged")}</span>
                  </>
                ) : (
                  <>
                    <StatusBadge status={c.old} /> → <StatusBadge status={c.new} />
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {more > 0 && <p className="muted small">{t("since.more", more)}</p>}
    </section>
  );
}

function Controls({ controls, scanId, worse, focus, onFocused }: { controls: ControlRow[]; scanId: number; worse: Set<string>; focus: string | null; onFocused: () => void }) {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const [shown, setShown] = useState<Set<Status>>(new Set(["FAIL", "ERROR", "MANUAL", "WAIVED"]));
  const [open, setOpen] = useState<string | null>(null);
  // The stored result holds the evidence. It is fetched the first time a control is opened and kept.
  const [wanted, setWanted] = useState(false);
  const doc = useAsync(() => (wanted ? api.scan(scanId) : Promise.resolve(null as ScanDoc | null)), [wanted, scanId]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return controls.filter((c) => shown.has(c.status) && (!needle || c.id.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle) || (c.titleKo ?? "").toLowerCase().includes(needle))).sort(compareControls);
  }, [controls, q, shown]);

  // A control picked in "since the previous scan": clear the search, show its status, open it, once.
  const scrollTo = useRef<string | null>(null);
  const [jump, setJump] = useState(0); // a second pick of the control already open still scrolls to it
  useEffect(() => {
    if (!focus) return;
    const c = controls.find((x) => `${x.profile}/${x.id}` === focus);
    if (c) {
      setQ("");
      setShown((prev) => (prev.has(c.status) ? prev : new Set([...prev, c.status])));
      setWanted(true);
      setOpen(focus);
      scrollTo.current = focus;
      setJump((n) => n + 1);
    }
    onFocused();
  }, [focus, controls, onFocused]);
  // and bring it into view once it is in the list
  useEffect(() => {
    if (!scrollTo.current || open !== scrollTo.current) return;
    const row = document.getElementById(`control-${scrollTo.current}`)?.querySelector<HTMLElement>(".control-row");
    scrollTo.current = null;
    row?.scrollIntoView({ block: "center" });
    row?.focus({ preventScroll: true });
  }, [open, rows, jump]);

  if (controls.length === 0) return <Empty>{t("host.noControls")}</Empty>;
  const toggleStatus = (s: Status) =>
    setShown((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  const toggleOpen = (key: string) => {
    setWanted(true);
    setOpen((cur) => (cur === key ? null : key));
  };

  return (
    <section className="card flush">
      <div className="toolbar pad">
        <label className="search">
          <IconSearch />
          <input type="search" placeholder={t("host.filter")} aria-label={t("host.filter")} value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="chips" role="group">
          {STATUSES.map((s) => (
            <button key={s} className={`chip s-${s} ${shown.has(s) ? "on" : ""} ${controls.some((c) => c.status === s) ? "" : "zero"}`} aria-pressed={shown.has(s)} onClick={() => toggleStatus(s)}>
              {t(`status.${s}`)} <span className="count">{controls.filter((c) => c.status === s).length}</span>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <Empty>{t("host.empty")}</Empty>
      ) : (
        <div className="areas">
          {groupByArea(rows).map((g) => (
            <section key={g.area} aria-labelledby={g.area ? `area-${g.area}` : undefined}>
              {g.area !== "" && (
                <h3 className="area-head" id={`area-${g.area}`}>
                  {t(`area.${g.area}`)}{" "}
                  <span className="muted small">
                    {(["FAIL", "ERROR", "MANUAL"] as Status[])
                      .map((st) => [st, g.rows.filter((c) => c.status === st).length] as const)
                      .filter(([, n]) => n > 0)
                      .map(([st, n]) => `${t(`status.${st}`)} ${n}`)
                      .join(" · ")}
                  </span>
                </h3>
              )}
              <ul className="controls">
                {g.rows.map((c) => {
                  const key = `${c.profile}/${c.id}`;
                  const expanded = open === key;
                  return (
                    <li key={key} id={`control-${key}`} className={expanded ? "open" : ""}>
                      <div
                        className="control-row"
                        role="button"
                        tabIndex={0}
                        aria-expanded={expanded}
                        onClick={() => toggleOpen(key)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault(); // Space must not scroll the page
                            toggleOpen(key);
                          }
                        }}
                      >
                        <IconChevron open={expanded} />
                        <span className="mono id">{c.id}</span>
                        <span className="control-title">
                          {worse.has(key) && <span className="kind kind-regressed">{t("change.regressed")}</span>} {ctitle(c, lang)}
                        </span>
                        <Severity value={c.severity} />
                        <StatusBadge status={c.status} />
                      </div>
                      {expanded && (
                        <div className="control-body">
                          {doc.loading && !doc.data && <p className="muted">{t("loading")}</p>}
                          {doc.error && <p className="error-text">{doc.error.message}</p>}
                          {doc.data && <ControlDetail control={c} doc={doc.data} />}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The rows in the areas of their profile (accounts, files, services, patches, logs), each area in the list's order. Rows of a profile
 * without areas (a policy pack's) come last, as "other"; with no area at all there is one group and no heading.
 */
function groupByArea(rows: ControlRow[]): { area: string; rows: ControlRow[] }[] {
  if (!rows.some((c) => c.area)) return [{ area: "", rows }];
  const order = ["accounts", "files", "services", "patches", "logs"];
  const groups = new Map<string, ControlRow[]>();
  for (const c of rows) {
    const a = c.area && order.includes(c.area) ? c.area : "other";
    groups.set(a, [...(groups.get(a) ?? []), c]);
  }
  return [...order, "other"].filter((a) => groups.has(a)).map((a) => ({ area: a, rows: groups.get(a) ?? [] }));
}

/** The checks of a control and what they observed. All of it is host text: shown as text only. */
function ControlDetail({ control, doc }: { control: ControlRow; doc: ScanDoc }) {
  const { t, lang } = useI18n();
  const dc = doc.controls.find((x) => x.profile === control.profile && x.id === control.id);
  const checks = (dc?.checks ?? []).map((ref) => doc.checks.find((c) => c.ref === ref)).filter((c) => c !== undefined);
  return (
    <>
      {dc?.reason && <p className="muted">{dc.reason}</p>}
      {dc?.waiver && <p className="notice">{t("host.waived", { reason: dc.waiver.reason, expires: dc.waiver.expires })}</p>}
      {checks.length === 0 && <p className="muted">{t("host.noEvidence")}</p>}
      {checks.map((ch) => (
        <div key={ch.ref} className="check">
          <div className="check-head">
            <StatusBadge status={ch.status} /> <span className="mono">{ch.ref}</span> <span className="muted">{localized(lang, ch.title, ch.titleKo)}</span>
          </div>
          {ch.reason && <p className="muted small">{localized(lang, ch.reason, ch.reasonKo)}</p>}
          {ch.remediation && (
            <p className="prose remedy small">
              <strong>{t("host.howToFix")}</strong> <Inline text={localized(lang, ch.remediation, ch.remediationKo)} />
            </p>
          )}
          {(ch.evidence?.length ?? 0) > 0 ? (
            <pre className="evidence">
              {ch.evidence?.map((e) => `${e.text.startsWith(e.key) ? "" : `${e.key} `}${e.text}${e.source ? `   ${e.source}` : ""}`).join("\n")}
              {(ch.evidenceOmitted ?? 0) > 0 ? `\n… +${ch.evidenceOmitted}` : ""}
            </pre>
          ) : (
            <p className="muted small">{t("host.noEvidence")}</p>
          )}
        </div>
      ))}
    </>
  );
}

function History({ scans, initial }: { scans: ScanRow[]; initial: [number, number] | null }) {
  const { t } = useI18n();
  const now = useNow();
  const [pair, setPair] = useState<[number, number] | null>(initial);
  // A comparison asked for from "since the previous scan" is below the chart and the list: bring it into view.
  const card = useRef<HTMLElement>(null);
  useEffect(() => {
    if (initial) card.current?.scrollIntoView({ block: "start" });
  }, [initial]);
  const diff = useAsync(() => (pair ? api.diff(pair[0], pair[1]) : Promise.resolve(null as Diff | null)), [pair?.[0], pair?.[1]], false);
  return (
    <div className="stack">
      <section className="card">
        <h2>{t("host.history")}</h2>
        {scans.length >= 2 && (
          <TrendChart
            label={t("host.history")}
            points={[...scans].reverse().map((s) => ({
              at: s.receivedAt,
              score: s.score,
              detail: t("trend.scanDetail", { scan: t("host.scan", { id: s.id }), fail: s.counts.FAIL ?? 0 }),
            }))}
          />
        )}
      </section>
      <section className="card flush">
        <ul className="scans">
          {scans.map((s, i) => {
            const previous = scans[i + 1];
            return (
              <li key={s.id}>
                {DEMO ? (
                  <span>{t("host.scan", { id: s.id })}</span>
                ) : (
                  <a href={`/api/v1/scans/${s.id}`} target="_blank" rel="noreferrer" title={t("host.raw")}>
                    {t("host.scan", { id: s.id })}
                  </a>
                )}
                <span className="muted small">{ago(s.receivedAt, now, t)}</span>
                {s.imageRef ? (
                  <span className="muted small mono" title={s.imageDigest}>
                    {s.imageRef} {(s.imageDigest ?? "").slice(7, 19)}
                  </span>
                ) : (
                  <span className="muted small mono">{s.toolVersion}</span>
                )}
                <ScorePill score={s.score} />
                {s.signed && <SignedBadge />}
                <span className="small">
                  {s.counts.FAIL ? <span className="badge s-FAIL">{s.counts.FAIL}</span> : null}
                  {s.counts.ERROR ? <span className="badge s-ERROR">{s.counts.ERROR}</span> : null}
                </span>
                <span className="push">
                  {!DEMO && (
                    <a className="button compact" href={api.scanCSV(s.id)} download title={t("host.csv")} aria-label={`CSV: ${t("host.scan", { id: s.id })}`}>
                      <IconDownload /> CSV
                    </a>
                  )}
                  {previous && (
                    <button className="compact" title={t("host.compare")} onClick={() => setPair([previous.id, s.id])}>
                      {t("host.compare")}
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </section>
      {pair && (
        <section className="card" ref={card}>
          <div className="titlebar">
            <h2>
              {t("host.scan", { id: pair[0] })} → {t("host.scan", { id: pair[1] })}
            </h2>
            <button onClick={() => setPair(null)}>{t("diff.close")}</button>
          </div>
          <Await state={diff} skeleton={<p className="muted">{t("loading")}</p>}>
            {(d) => (d ? <DiffView diff={d} /> : null)}
          </Await>
        </section>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: Diff }) {
  const { t, lang } = useI18n();
  const section = (title: string, tone: string, list: ControlChange[]) =>
    !list || list.length === 0 ? null : (
      <div key={title} className={`diffgroup ${tone}`}>
        <h3>
          {title} <span className="count">{list.length}</span>
        </h3>
        <ul className="difflist">
          {list.map((c) => (
            <li key={`${c.profile}/${c.id}`}>
              <div>
                <span className="mono id">{c.id}</span> {ctitle(c, lang)} <StatusBadge status={c.old} />
                {c.old === c.new ? <span className="muted small"> {t("diff.checksChanged")}</span> : <> → <StatusBadge status={c.new} /></>}
              </div>
              {c.checks.length > 0 && (
                <ul>
                  {c.checks.map((ch) => (
                    <li key={ch.ref} className="small">
                      <span className="mono">{ch.ref}</span> <StatusBadge status={ch.old} /> → <StatusBadge status={ch.new} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
    );
  return (
    <>
      {diff.notes.map((n) => (
        <p key={n} className="notice">
          {n}
        </p>
      ))}
      {section(t("diff.regressed"), "bad", diff.regressed)}
      {section(t("diff.fixed"), "good", diff.fixed)}
      {section(t("diff.changed"), "warn", diff.changed)}
      {section(t("diff.added"), "", diff.added)}
      {section(t("diff.removed"), "", diff.removed)}
      <p className="muted small">{t("diff.unchanged", diff.unchanged)}</p>
    </>
  );
}

/**
 * "Scan now": asks the agent of the host for a scan (ADR 0014). It shows only for a host whose agent is connected,
 * and the button only for a session that may ask (an operator token); the server decides either way.
 */
function ScanNow({ hostId, onDone }: { hostId: number; onDone: () => void }) {
  const { t } = useI18n();
  const session = useAsync(() => api.session(), [], false);
  const agent = useAsync(() => api.hostAgent(hostId), [hostId], false);
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState("");
  const data = agent.data;
  const pending = data?.job?.state === "queued" || data?.job?.state === "claimed";
  const reloadAgent = agent.reload;
  useEffect(() => {
    if (!pending) return;
    // The state of a request is asked for every few seconds while it is open.
    const id = setInterval(reloadAgent, 3000);
    return () => clearInterval(id);
  }, [pending, reloadAgent]);
  // The request this page made: when its result comes in, the host's page is loaded again once.
  const [awaiting, setAwaiting] = useState(0);
  const [arrived, setArrived] = useState(false);
  const job = data?.job;
  useEffect(() => {
    if (awaiting && job?.id === awaiting && job.state === "done") {
      setArrived(true);
      setAwaiting(0);
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [awaiting, job?.id, job?.state]);

  if (!data || !data.online || data.profiles.length === 0) return null;
  const chosen = data.profiles.includes(profile) ? profile : data.profiles[0];
  const ask = async () => {
    setBusy(true);
    setRefused("");
    try {
      const res = await api.requestScan(hostId, chosen);
      setArrived(false);
      setAwaiting(res.job.id);
      reloadAgent();
    } catch (e) {
      const err = e as ApiError;
      setRefused(err.status === 429 ? t("scan.tooSoon") : t("scan.refused", { error: err.message }));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card scannow" aria-label={t("scan.title")}>
      <div className="scannow-main">
        <span className="badge s-PASS">{t("scan.agentOnline")}</span>
        {session.data?.canScan ? (
          <>
            {data.profiles.length > 1 && (
              <label className="inline">
                {t("scan.profile")}{" "}
                <select value={chosen} onChange={(e) => setProfile(e.target.value)}>
                  {data.profiles.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button className="primary" disabled={busy || pending} onClick={ask}>
              {t("scan.button")}
            </button>
          </>
        ) : (
          <span className="muted small">{t("scan.hint")}</span>
        )}
      </div>
      <p className="muted small" role="status" aria-live="polite">
        {refused || (arrived ? t("scan.done") : job && job.state !== "done" ? (job.state === "failed" ? t("scan.failed", { error: job.error ?? "" }) : t(`scan.${job.state}`)) : "")}
      </p>
    </section>
  );
}
