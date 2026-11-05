"""Notebook algorithms extracted from 04_kumeleme.ipynb; parameters unchanged."""
import re
import numpy as np
import pandas as pd
from drain3 import TemplateMiner
from drain3.template_miner_config import TemplateMinerConfig
from drain3.masking import MaskingInstruction
from sklearn.cluster import HDBSCAN

def parse_logs(lines):
    pattern = re.compile(
        r"^(?P<date>\d{4}-\d{2}-\d{2}) (?P<time>\d{2}:\d{2}:\d{2},\d{3}) "
        r"(?P<level>[A-Z]+) \[(?P<thread>[^\]]*)\] (?P<component>\S+): (?P<message>.*)$"
    )
    rows = []
    for line in lines:
        m = pattern.match(line.rstrip("\n"))
        if m:
            rows.append(m.groupdict())
    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError("No matching Hadoop log lines")
    df["ts"] = pd.to_datetime(df["date"] + " " + df["time"].str.replace(",", ".", regex=False),
                              format="%Y-%m-%d %H:%M:%S.%f")
    
    MASKS = [
        ("ID",  r"\b(?:application|appattempt|container|job|task|attempt)_[\w]+"),
        ("BLK", r"blk_-?\d+(?:_\d+)?"),
        ("IP",  r"\d+\.\d+\.\d+\.\d+"),
        ("DUR", r"-?\d+(?:ms|s)\b"),
        ("NUM", r"\b\d+\b"),
    ]
    config = TemplateMinerConfig()
    config.drain_sim_th = 0.4
    config.drain_depth = 4
    config.masking_instructions = [MaskingInstruction(rx, name) for name, rx in MASKS]
    miner = TemplateMiner(config=config)
    df["cluster_id"] = [miner.add_log_message(m)["cluster_id"] for m in df["message"]]
    tmap = {c.cluster_id: c.get_template() for c in miner.drain.clusters}
    df["template"] = df["cluster_id"].map(tmap)
    
    SUSP = re.compile(r"fail|exception|error|timeout|timed out|refused|no route|unreachable|killed|denied|retry|retrying", re.I)
    BENIGN = re.compile(r"maxTaskFailuresPerNode")
    df["suspicious"] = df["message"].apply(lambda m: bool(SUSP.search(m)) and not BENIGN.search(m))
    df["important"] = df["level"].isin(["ERROR", "WARN", "FATAL"]) | df["suspicious"]
    
    tpl = (df.groupby("cluster_id")
             .agg(template=("template", "first"),
                  component=("component", lambda s: s.mode()[0]),
                  count=("message", "size"),
                  n_important=("important", "sum"),
                  first=("ts", "min"), last=("ts", "max"))
             .reset_index())
    tpl["important"] = (tpl["n_important"] / tpl["count"]) >= 0.5
    
    
    if df.empty:
        raise ValueError("No matching Hadoop log lines")
    return df, tpl, tmap, MASKS

def extract_params(msg, MASKS):
    found = {}
    for name, rx in MASKS:
        def repl(m, name=name):
            found.setdefault(name, []).append(m.group(0))
            return f"<{name}>"
        msg = re.sub(rx, repl, msg)
    return found


def _num(v):
    m = re.match(r"-?\d+", v)
    return int(m.group()) if m else 0

def field_stats(sub):
    keys = {}
    for p in sub["params"]:
        for name, vals in p.items():
            for k, v in enumerate(vals):
                keys.setdefault(f"{name}#{k+1}", []).append(v)
    out = {}
    for key, vals in keys.items():
        uniq = set(vals)
        if len(uniq) == 1:
            continue
        numeric = key.split("#")[0] in ("NUM", "DUR")
        ordered = sorted(uniq, key=_num) if numeric else sorted(uniq)
        info = {"unique": len(uniq), "example": ordered[:3]}
        if numeric:
            nums = [_num(v) for v in vals]
            info["min"], info["max"] = min(nums), max(nums)
        out[key] = info
    return out


def build_package(df, tpl, tmap, MASKS):
    df = df.copy()
    df["params"] = df["message"].apply(lambda msg: extract_params(msg, MASKS))
    cid2hdb = tpl.set_index("cluster_id")["hdb"]
    GAP = 30
    CONTEXT_SEC = 120
    
    imp = df[df["important"]].sort_values("ts").copy()
    imp["win"] = (imp["ts"].diff() > pd.Timedelta(seconds=GAP)).cumsum()
    
    def template_item(gg, cid):
        return {
            "template": tmap[cid],
            "example": gg["message"].iloc[0][:250],
            "count": int(len(gg)),
            "first": str(gg["ts"].min().time()),
            "last": str(gg["ts"].max().time()),
            "levels": {k: int(v) for k, v in gg["level"].value_counts().items()},
            "varying_fields": field_stats(gg),
            "embedding_cluster": int(cid2hdb[cid]),
        }
    
    events = []
    for w, g in imp.groupby("win"):
        start = g["ts"].min()
        items = sorted((template_item(gg, cid) for cid, gg in g.groupby("cluster_id")),
                       key=lambda x: -x["count"])
        before = imp[(imp["ts"] < start) & (imp["ts"] >= start - pd.Timedelta(seconds=CONTEXT_SEC))]
        events.append({
            "event_id": int(w),
            "start": str(start),
            "end": str(g["ts"].max()),
            "n_rows": int(len(g)),
            "templates": items,
            "context_before": [{"time": str(r.ts.time()), "level": r.level, "message": r.message[:200]}
                               for r in before.itertuples()],
        })
    
    out = {
        "sample_start": str(df["ts"].min()),
        "sample_end": str(df["ts"].max()),
        "n_rows_total": int(len(df)),
        "note": "Log örneği sample_end anında kesiliyor; o ana kadar bitmemiş bir olayın çözüldüğü varsayılamaz.",
        "events": events,
    }
    
    all_rows = df.sort_values("ts")
    for e in events:
        start = pd.Timestamp(e["start"])
        prev = all_rows[all_rows["ts"] < start].tail(5)
        e["preceding_lines"] = [{"time": str(r.ts.time())[:12], "level": r.level, "message": r.message[:200]}
                                for r in prev.itertuples()]
    out["events"] = events
    
    act = df.groupby([df["ts"].dt.strftime("%H:%M"), "important"]).size().unstack(fill_value=0)
    out["activity_per_minute"] = {k: {"normal": int(r.get(False, 0)), "flagged": int(r.get(True, 0))}
                                  for k, r in act.iterrows()}
    
    def related(e, window=120, cap=15):
        ids = set()
        for t in e["templates"]:
            ids.update(re.findall(r"(?:container|attempt|job|task)_[\w]+", t["example"]))
        if not ids:
            return []
        lo = pd.Timestamp(e["start"]) - pd.Timedelta(seconds=window)
        hi = pd.Timestamp(e["end"]) + pd.Timedelta(seconds=window)
        sub = df[(df["ts"] >= lo) & (df["ts"] <= hi)]
        sub = sub[~sub["message"].str.contains("Progress of TaskAttempt", regex=False)]
        hit = sub[sub["message"].apply(lambda m: any(i in m for i in ids))]
        return [{"time": str(r.ts.time())[:12], "level": r.level, "message": r.message[:220]}
                for r in hit.head(cap).itertuples()]
    
    for e in events:
        e["related_lines"] = related(e) if e["n_rows"] <= 5 else []
    out["events"] = events
    
    
    if not events or not prog_available(df):
        return out
    prog = df[df["message"].str.contains("Progress of TaskAttempt", regex=False)].copy()
    prog["att"] = prog["message"].str.extract(r"(attempt_\S+)")[0]
    att_rows = []
    for a in sorted(prog["att"].unique()):
        p = prog[prog["att"] == a]
        vals = p["message"].str.extract(r"is : ([\d.]+)")[0]
        same_tail = int((vals == vals.iloc[-1]).iloc[::-1].astype(int).cumprod().sum())
        gp = p["ts"].diff().fillna(pd.Timedelta(0))
        pos = int(gp.values.argmax())
        after = df[df["message"].str.contains(a, regex=False)
                   & ~df["message"].str.contains("Progress of TaskAttempt", regex=False)
                   & (df["ts"] > p["ts"].iloc[-1])]
        if after["message"].str.contains("to FAILED", regex=False).any():
            outcome = "FAILED"
        elif after["message"].str.contains("to SUCCEEDED", regex=False).any():
            outcome = "SUCCEEDED"
        else:
            outcome = "no outcome in sample"
        att_rows.append({
            "attempt": a[-10:],
            "first_report": str(p["ts"].iloc[0].time())[:12],
            "last_report": str(p["ts"].iloc[-1].time())[:12],
            "last_value": vals.iloc[-1],
            "identical_tail_reports": same_tail,
            "longest_report_gap_sec": round(gp.iloc[pos].total_seconds(), 1),
            "gap_from": str(p["ts"].iloc[pos - 1].time())[:12] if pos > 0 else None,
            "gap_to": str(p["ts"].iloc[pos].time())[:12] if pos > 0 else None,
            "outcome": outcome,
        })
    
    allts = df["ts"].sort_values().reset_index(drop=True)
    g = allts.diff().fillna(pd.Timedelta(0))
    pos = int(g.values.argmax())
    silence = {"from": str(allts.iloc[pos - 1].time())[:12], "to": str(allts.iloc[pos].time())[:12],
               "seconds": round(g.iloc[pos].total_seconds(), 1)}
    
    big = max(events, key=lambda e: e["n_rows"])
    t0 = pd.Timestamp(big["start"])
    first_normal = df[(df["ts"] >= t0) & (~df["important"])]["ts"].min()
    
    out["pre_storm_facts"] = {
        "note": "Yorumsuz olgular: log satırlarından hesaplandı, sebep iddiası içermez.",
        "map_attempt_progress": att_rows,
        "longest_silence_all_lines": silence,
        "largest_event_first_line": big["start"][11:23],
        "first_normal_line_after_largest_event_start": str(first_normal.time())[:12] if pd.notna(first_normal) else None,
    }
    
    return out

def prog_available(df):
    return df["message"].str.contains("Progress of TaskAttempt", regex=False).any()

def cluster_templates(emb):
    if len(emb) < 2:
        return np.full(len(emb), -1, dtype=int)
    return HDBSCAN(min_cluster_size=2, min_samples=1, metric="euclidean").fit_predict(emb)

