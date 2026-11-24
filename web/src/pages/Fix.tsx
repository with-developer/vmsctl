import { Fragment, useMemo, useState } from "react";
import { api } from "../lib/api";
import { useAsync, useNow } from "../lib/hooks";
import { useI18n } from "../lib/i18n";
import { AREAS, ago, ctitle, localized } from "../lib/format";
import { Await, Empty, Inline, PageHeader, Severity, Skeleton, StatusBadge } from "../components/ui";
import { IconSearch } from "../components/icons";
import { ControlDetail } from "./Host";
import { STALE_DAYS } from "./Overview";
import type { ControlHost, ControlInfo, ControlSummary, ScanDoc } from "../lib/types";

/** The weight of a severity in the order to fix in, as the server's (internal/server, the overview's "fix first"). */
const WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 };

/** The order to fix in, the overview's "fix first": severity times the hosts that fail, then the hosts, then the ID as text. */
export function fixOrder(a: ControlSummary, b: ControlSummary): number {
  const fa = a.counts.FAIL ?? 0;
  const fb = b.counts.FAIL ?? 0;
  return fb * (WEIGHT[b.severity] ?? 1) - fa * (WEIGHT[a.severity] ?? 1) || fb - fa || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * The remediation page: the failing controls in the order to fix them on the left, and on the right the chosen one's fix and the hosts
 * that fail it, how long each has, and the evidence of each.
 */
export function FixPage({ profile, id }: { profile?: string; id?: string }) {
  const { t, lang } = useI18n();
  const state = useAsync(() => api.controls(), []);
  const [q, setQ] = useState("");
  const [severity, setSeverity] = useState("");
  const [area, setArea] = useState("");
  const failing = useMemo(() => (state.data?.controls ?? []).filter((c) => (c.counts.FAIL ?? 0) > 0).sort(fixOrder), [state.data]);
  const queue = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return failing.filter(
      (c) =>
        (!severity || c.severity === severity) &&
        (!area || c.area === area) &&
        (!needle || c.id.toLowerCase().includes(needle) || c.title.toLowerCase().includes(needle) || (c.titleKo ?? "").toLowerCase().includes(needle)),
    );
  }, [failing, q, severity, area]);
  const areas = AREAS.filter((a) => failing.some((c) => c.area === a));
  const chosen = profile && id ? { profile, id } : queue[0] ? { profile: queue[0].profile, id: queue[0].id } : null;

  return (
    <>
      <PageHeader title={t("fix.title")} subtitle={t("fix.subtitle")} />
      <Await state={state} skeleton={<div className="card"><Skeleton height={260} /></div>}>
        {() =>
          failing.length === 0 ? (
            <Empty>{t("fix.none")}</Empty>
          ) : (
            <div className="workbench">
              <section className="card flush queue" aria-label={t("fix.queue")}>
                <div className="queue-filters">
                  <label className="search">
                    <IconSearch />
                    <input type="search" placeholder={t("controls.search")} aria-label={t("controls.search")} value={q} onChange={(e) => setQ(e.target.value)} />
                  </label>
                  <div className="queue-selects">
                    <select aria-label={t("fix.severity")} value={severity} onChange={(e) => setSeverity(e.target.value)}>
                      <option value="">{t("fix.allSeverities")}</option>
                      {["high", "medium", "low"].map((s) => (
                        <option key={s} value={s}>
                          {t(`severity.${s}`)}
                        </option>
                      ))}
                    </select>
                    {areas.length > 0 && (
                      <select aria-label={t("fix.area")} value={area} onChange={(e) => setArea(e.target.value)}>
                        <option value="">{t("fix.allAreas")}</option>
                        {areas.map((a) => (
                          <option key={a} value={a}>
                            {t(`area.${a}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                </div>
                {queue.length === 0 ? (
                  <Empty>{t("controls.noMatch")}</Empty>
                ) : (
                  <ol className="queue-list">
                    {queue.map((c) => {
                      const on = chosen?.profile === c.profile && chosen.id === c.id;
                      return (
                        <li key={`${c.profile}/${c.id}`}>
                          <a href={`#/fix/${encodeURIComponent(c.profile)}/${encodeURIComponent(c.id)}`} aria-current={on ? "true" : undefined} className={on ? "on" : ""}>
                            <span className="queue-title">
                              <span className="mono id">{c.id}</span> {ctitle(c, lang)}
                            </span>
                            <span className="muted small">
                              <Severity value={c.severity} /> · {t("overview.onHosts", c.counts.FAIL ?? 0)}
                            </span>
                          </a>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </section>
              {chosen && <FixDetail key={`${chosen.profile}/${chosen.id}`} profile={chosen.profile} id={chosen.id} />}
            </div>
          )
        }
      </Await>
    </>
  );
}

/** One control: what to do, and the hosts to do it on. */
function FixDetail({ profile, id }: { profile: string; id: string }) {
  const { t, lang } = useI18n();
  const now = useNow();
  const state = useAsync(() => api.control(profile, id, STALE_DAYS), [profile, id], false);
  return (
    <div className="stack workbench-main">
      <Await state={state} skeleton={<div className="card"><Skeleton height={200} /></div>}>
        {({ control: c, info }) => {
          // the longest failing first: those have waited the longest
          const failing = c.hosts
            .filter((h) => h.status === "FAIL")
            .sort((a, b) => (a.failingSince && b.failingSince ? a.failingSince.localeCompare(b.failingSince) : a.failingSince ? -1 : b.failingSince ? 1 : 0) || a.host.localeCompare(b.host));
          const fixes = (info?.checks ?? []).filter((ch) => localized(lang, ch.remediation, ch.remediationKo));
          return (
            <>
              <section className="card">
                <div className="titlebar">
                  <h2>
                    <span className="mono">{c.id}</span> {ctitle({ title: c.title, titleKo: c.titleKo ?? info?.titleKo }, lang)}
                  </h2>
                  <a href={`#/controls/${encodeURIComponent(c.profile)}/${encodeURIComponent(c.id)}`}>{t("fix.controlPage")}</a>
                </div>
                <p className="muted small">
                  <Severity value={c.severity} /> · {c.profile}
                  {c.area ? ` · ${t(`area.${c.area}`)}` : ""} · {t("overview.onHosts", failing.length)}
                </p>
                {(info?.manual || fixes.length > 0) && <h3>{t("fix.howTo")}</h3>}
                {info?.manual && <p className="prose">{localized(lang, info.manual, info.manualKo)}</p>}
                {fixes.map((ch) => (
                    <Fragment key={ch.id}>
                      <p className="small">
                        <span className="mono">{ch.id}</span> {lang === "ko" && ch.titleKo ? ch.titleKo : ch.title}
                      </p>
                      <p className="prose remedy">
                        <Inline text={localized(lang, ch.remediation, ch.remediationKo)} />
                      </p>
                    </Fragment>
                  ))}
              </section>
              <section className="card flush">
                <h3 className="fixhosts-head">{t("fix.hosts")}</h3>
                {failing.length === 0 ? (
                  <Empty>{t("overview.none")}</Empty>
                ) : (
                  <ul className="fixhosts">
                    {failing.map((h) => (
                      <FixHost key={h.hostId} host={h} profile={c.profile} id={c.id} now={now} info={info ?? null} />
                    ))}
                  </ul>
                )}
              </section>
            </>
          );
        }}
      </Await>
    </div>
  );
}

/** A host that fails the control: since when, and, on request, the evidence of its latest scan. */
function FixHost({ host: h, profile, id, now, info }: { host: ControlHost; profile: string; id: string; now: number; info: ControlInfo | null }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  // fetched the first time it is opened, and kept when it is closed
  const [wanted, setWanted] = useState(false);
  const doc = useAsync(() => (wanted ? api.scan(h.scanId) : Promise.resolve(null as ScanDoc | null)), [wanted, h.scanId]);
  return (
    <li className={open ? "open" : ""}>
      <div className="fixhost-row">
        <a className="hostname" href={`#/hosts/${h.hostId}`}>
          {h.host}
        </a>
        {h.stale && <span className="badge s-MANUAL">{t("stale")}</span>}
        <span className="muted small">{h.failingSince ? t("fix.since", { ago: ago(h.failingSince, now, t) }) : ""}</span>
        <span className="push">
          <StatusBadge status={h.status} />
          <button
            className="compact"
            aria-expanded={open}
            onClick={() => {
              setWanted(true);
              setOpen((v) => !v);
            }}
          >
            {open ? t("fix.hideEvidence") : t("fix.showEvidence")}
          </button>
        </span>
      </div>
      {open && (
        <div className="control-body">
          {doc.loading && !doc.data && <p className="muted">{t("loading")}</p>}
          {doc.error && <p className="error-text">{doc.error.message}</p>}
          {/* the fix is said once, above the hosts: the evidence alone here */}
          {doc.data && <ControlDetail control={{ profile, id }} doc={doc.data} info={info} showFix={false} />}
        </div>
      )}
    </li>
  );
}
