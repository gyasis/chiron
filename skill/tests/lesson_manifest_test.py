"""lesson_manifest_test — the one manifest writer: stamp merge rules, domain table, system inference, the bundler and
the server keep stamped keys, a domainless lesson is never baked under a guess, and every lesson chain stamps.
No model is called and no server is started; CHIRON_SKILL/CHIRON_GEN point at temp dirs.
Run: ~/miniconda3/bin/python tests/lesson_manifest_test.py"""
import json, os, shutil, subprocess, sys, tempfile, unittest
from pathlib import Path

SKILL = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(SKILL / "scripts"))
import lesson_manifest as lm  # noqa: E402

TMP = Path(tempfile.mkdtemp(prefix="chiron-manifest-"))
(TMP / "skill" / "server").mkdir(parents=True)
for sub in SKILL.iterdir():
    if sub.is_dir() and sub.name not in ("server", "node_modules", "tests"):
        os.symlink(sub, TMP / "skill" / sub.name)
for f in (SKILL / "server").iterdir():
    if f.name not in ("state", "__pycache__"):
        os.symlink(f, TMP / "skill" / "server" / f.name)
os.environ.update(CHIRON_SKILL=str(TMP / "skill"), CHIRON_GEN=str(TMP / "gen"), CHIRON_HUB_PLAIN="http://127.0.0.1:9")
GEN = TMP / "gen"
GEN.mkdir()


def mk(name, title="Page Title", cj=None, root=GEN):
    d = root / name
    d.mkdir(parents=True, exist_ok=True)
    (d / "lesson.html").write_text(f"<html><head><title>{title}</title></head><body></body></html>")
    if cj is not None:
        (d / "chiron.json").write_text(json.dumps(cj))
    return d


class Stamp(unittest.TestCase):
    def test_new_manifest_defaults_title_from_page(self):
        d = mk("a1", "Atrial Fibrillation")
        cj = lm.stamp(d, domain="medicine", system="Cardiovascular")
        self.assertEqual(cj["format"], "chiron/1")
        self.assertEqual(cj["entry"], "lesson.html")
        self.assertEqual(cj["title"], "Atrial Fibrillation")
        self.assertEqual(cj["tags"], {"dom": "medicine", "sys": "Cardiovascular"})

    def test_merge_never_drops_keys_and_unions_labels(self):
        d = mk("a2", cj={"title": "T", "depth": "primer", "generated": "x", "labels": ["Ordine exam", "B"],
                         "tags": {"dom": "medicine", "subj": "Heart", "level": "B1"}})
        cj = lm.stamp(d, system="Anesthesia", labels=["B", "C"], scope="disease")
        self.assertEqual(cj["depth"], "primer")
        self.assertEqual(cj["generated"], "x")
        self.assertEqual(cj["labels"], ["Ordine exam", "B", "C"])
        self.assertEqual(cj["tags"], {"dom": "medicine", "subj": "Heart", "level": "B1", "sys": "Anesthesia", "scope": "disease"})
        self.assertEqual(cj["title"], "T")

    def test_provided_value_replaces_none_keeps(self):
        d = mk("a3", cj={"title": "Old", "status": "published", "domain": "medicine"})
        cj = lm.stamp(d, title="New", status=None, domain=None)
        self.assertEqual((cj["title"], cj["status"], cj["domain"]), ("New", "published", "medicine"))
        self.assertEqual(lm.stamp(d, status="staged")["status"], "staged")

    def test_extra_is_top_level(self):
        d = mk("a4")
        self.assertEqual(lm.stamp(d, extra={"audioClips": 7, "lessonFormat": "pimsleur"})["audioClips"], 7)

    def test_unknown_domain_rejected_and_nothing_written(self):
        d = mk("a5")
        with self.assertRaises(ValueError) as cm:
            lm.stamp(d, domain="astrology")
        self.assertIn("astrology", str(cm.exception))
        self.assertIn("medical-italian", str(cm.exception))
        self.assertFalse((d / "chiron.json").exists())

    def test_domain_is_normalized_on_write(self):
        d = mk("a6")
        cj = lm.stamp(d, domain="Italian")
        self.assertEqual((cj["domain"], cj["tags"]["dom"]), ("language-it", "language-it"))

    def test_atomic_write_leaves_no_temp_files(self):
        d = mk("a7")
        lm.stamp(d, domain="medicine")
        names = sorted(p.name for p in d.iterdir())
        self.assertEqual(names, [".chiron.json.lock", "chiron.json", "lesson.html"])
        json.loads((d / "chiron.json").read_text())

    def test_failed_write_keeps_old_file(self):
        d = mk("a8", cj={"title": "keep", "domain": "medicine"})
        with self.assertRaises(TypeError):
            lm.stamp(d, extra={"bad": object()})
        self.assertEqual(json.loads((d / "chiron.json").read_text())["title"], "keep")
        self.assertEqual([p.name for p in d.iterdir() if p.name.startswith(".chiron.json.") and p.name != ".chiron.json.lock"], [])


class Tables(unittest.TestCase):
    def test_normalize_domain(self):
        table = {"italian": "language-it", "language": "language-it", "language-it": "language-it", "it": "language-it",
                 "medical-italian": "medical-italian", "med-italian": "medical-italian", "medicina-italiana": "medical-italian",
                 "medicine": "medicine", "video-it": "video-it", "code": "code", " Medicine ": "medicine"}
        for k, v in table.items():
            self.assertEqual(lm.normalize_domain(k), v, k)
        for bad in ("", "astrology", None, 3, "medical"):
            self.assertIsNone(lm.normalize_domain(bad), bad)

    def test_infer_system(self):
        self.assertEqual(lm.infer_system("Rapid sequence induction", "Anaesthesia"), "Anesthesia")
        self.assertEqual(lm.infer_system(None, "anestesia generale"), "Anesthesia")
        self.assertIsNone(lm.infer_system("preparare la sala operatoria"))   # the OR alone is not anesthesia (surgery wards)
        self.assertIsNone(lm.infer_system("Atrial fibrillation", "cardiologia"))
        self.assertIsNone(lm.infer_system())

    def test_missing(self):
        self.assertEqual(lm.missing(mk("m1")), ["title", "domain"])
        self.assertEqual(lm.missing(mk("m2", cj={"title": "t", "domain": "medicine"})), ["tags.sys"])
        self.assertEqual(lm.missing(mk("m3", cj={"title": "t", "domain": "medicine", "tags": {"sys": "Renal"}})), [])
        self.assertEqual(lm.missing(mk("m4", cj={"title": "t", "domain": "language-it"})), [])
        self.assertEqual(lm.missing(mk("m5", cj={"title": "t", "domain": "italian"})), ["domain"])
        self.assertEqual(lm.missing(mk("m6", cj={"title": "t", "domain": "medical-italian"})), [])   # system optional

    def test_check_cli_exit_code(self):
        root = TMP / "chk"
        mk("ok", cj={"title": "t", "domain": "language-it"}, root=root)
        cmd = [sys.executable, str(SKILL / "scripts" / "lesson_manifest.py"), "check", str(root)]
        self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 0)
        mk("bad", root=root)
        self.assertEqual(subprocess.run(cmd, capture_output=True).returncode, 1)

    def test_repair_dry_run_changes_nothing_and_apply_stamps(self):
        root = TMP / "rep"
        mk("chiron-ward-airway-anesthesia", "Airway", root=root)
        mk("chiron-italian-cafe", "Cafe", root=root)
        mk("mystery", "Mystery", root=root)
        rep = TMP / "rep.md"
        lm.repair(root, False, rep)
        self.assertFalse((root / "mystery" / "chiron.json").exists())
        text = rep.read_text()
        self.assertIn("medical-italian", text)
        self.assertIn("Anesthesia", text)
        self.assertIn("mystery", text.split("## Undecided lessons")[1])
        lm.repair(root, True, rep)
        self.assertEqual(lm.read(root / "chiron-ward-airway-anesthesia")["tags"]["sys"], "Anesthesia")
        self.assertEqual(lm.read(root / "chiron-italian-cafe")["domain"], "language-it")
        self.assertNotIn("domain", lm.read(root / "mystery"))


@unittest.skipUnless(shutil.which("zip"), "zip not installed")
class Bundler(unittest.TestCase):
    def test_bundle_keeps_every_key(self):
        d = mk("b1", "Bundle Me", cj={"depth": "primer", "generated": "2026", "domain": "medical-italian",
                                       "tags": {"dom": "medical-italian", "sys": "Anesthesia"}, "labels": ["X"], "custom": 1})
        out = TMP / "b1.chiron"
        r = subprocess.run(["bash", str(SKILL / "scripts" / "bundle-lesson.sh"), str(d), str(out), "--no-fix", "--domain", "medicine"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        cj = lm.read(d)
        self.assertEqual((cj["depth"], cj["generated"], cj["custom"], cj["labels"]), ("primer", "2026", 1, ["X"]))
        self.assertEqual(cj["domain"], "medical-italian")        # the lesson's own domain beats --domain
        self.assertEqual(cj["tags"]["sys"], "Anesthesia")
        self.assertEqual((cj["title"], cj["slug"], cj["generator"]), ("Bundle Me", "b1", "chiron"))
        listing = subprocess.run(["unzip", "-Z1", str(out)], capture_output=True, text=True).stdout
        self.assertNotIn(".chiron.json.lock", listing)

    def test_bundle_normalizes_domain_argument(self):
        d = mk("b2", "Two")
        r = subprocess.run(["bash", str(SKILL / "scripts" / "bundle-lesson.sh"), str(d), str(TMP / "b2.chiron"), "--no-fix", "--domain", "language"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertEqual(lm.read(d)["domain"], "language-it")


class BakeScript(unittest.TestCase):
    def test_missing_manifest_goes_through_the_writer_and_warns(self):
        src = (SKILL / "scripts" / "bake-lesson-audio.mjs").read_text()
        self.assertIn("lesson_manifest.py", src)
        self.assertIn("WARNING", src)
        block = src[src.index("keep it in step with what is now on disk"):]
        self.assertIn("JSON.parse(fs.readFileSync(cjPath", block)       # read-modify-write: stored keys survive
        self.assertNotIn("writeFileSync(cjPath", block)                  # only the atomic tmp+rename write remains


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        sys.path.insert(0, str(SKILL / "server"))
        from fastapi.testclient import TestClient
        import app as A
        cls.A = A
        cls.c = TestClient(A.app)

    def setUp(self):
        self.A.JOBS.clear()
        self.A._GEN_PAUSED = True

    def test_job_for_slug_without_domain_is_409(self):
        mk("s1", cj={"subject": "afib"}, root=GEN)
        with self.assertRaises(self.A.HTTPException) as cm:
            self.A._job_for_slug("s1")
        self.assertEqual(cm.exception.status_code, 409)
        self.assertIn("s1", cm.exception.detail)
        self.assertIn("lesson_manifest.py stamp", cm.exception.detail)

    def test_job_for_slug_reads_and_normalizes_domain(self):
        mk("s2", cj={"subject": "caffe", "domain": "italian"}, root=GEN)
        self.assertEqual(self.A._job_for_slug("s2")["domain"], "language-it")

    def test_bake_endpoint_409_and_batch_skips(self):
        mk("s3", cj={"subject": "x"}, root=GEN)
        mk("s4", cj={"subject": "y", "domain": "medicine"}, root=GEN)
        self.assertEqual(self.c.post("/bake/s3").status_code, 409)
        queued = []
        self.A._enqueue_bake = lambda job, engine: queued.append(job["slug"])
        r = self.c.post("/bake-batch", json={"slugs": ["s3", "s4"], "engine": "mac"}).json()
        self.assertEqual(queued, ["s4"])
        self.assertEqual([s["slug"] for s in r["skipped"]], ["s3"])

    def test_write_status_normalizes_and_keeps_chain_values(self):
        d = mk("s5", cj={"title": "T", "domain": "medical-italian", "tags": {"dom": "medical-italian", "sys": "Anesthesia"},
                         "depth": "ward", "subject": "airway"}, root=GEN)
        job = {"domain": "italian", "depth": "primer", "subject": "other", "extra": {"system": "Cardiovascular"}}
        self.A._write_status(d, job, "staged")
        cj = lm.read(d)
        self.assertEqual((cj["domain"], cj["depth"], cj["subject"], cj["status"]), ("medical-italian", "ward", "airway", "staged"))
        self.assertEqual(cj["tags"]["sys"], "Anesthesia")
        self.assertIn("generated", cj)

    def test_write_status_fills_a_blank_lesson(self):
        d = mk("s6", root=GEN)
        self.A._write_status(d, {"domain": "italian", "depth": "pure", "subject": "caffe"}, "staged")
        cj = lm.read(d)
        self.assertEqual((cj["domain"], cj["tags"]["dom"]), ("language-it", "language-it"))
        d2 = mk("s7", root=GEN)
        self.A._write_status(d2, {"domain": "medicine", "subject": "Anestesia generale"}, "staged")
        self.assertEqual(lm.read(d2)["tags"]["sys"], "Anesthesia")


class ChainsStamp(unittest.TestCase):
    def test_every_lesson_chain_stamps(self):
        chains = sorted((SKILL / "chains").glob("*/run.py"))
        producers = [c for c in chains if "lesson.html" in c.read_text() or "assemble-" in c.read_text()]
        self.assertGreaterEqual(len(producers), 9)
        for c in producers:
            self.assertRegex(c.read_text(), r"lesson_manifest\.stamp\(", f"{c.parent.name} never calls lesson_manifest.stamp")

    def test_no_chain_overwrites_the_manifest(self):
        for c in (SKILL / "chains").glob("*/run.py"):
            self.assertNotIn('(OUT / "chiron.json").write_text', c.read_text(), c.parent.name)
        for name in ("episode_pipeline.py", "fsi-compose.py"):
            self.assertNotIn('"chiron.json").write_text', (SKILL / "scripts" / name).read_text(), name)


if __name__ == "__main__":
    unittest.main()
