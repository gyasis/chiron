"""videos_test — catalog build, media route safety, /api/videos local flags and the phone-copy state machine.
Run: python3 skill/tests/videos_test.py"""
import json, os, queue, sys, tempfile, time, unittest
from pathlib import Path
from unittest import mock

HERE = os.path.dirname(__file__)
SKILL = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(SKILL, "scripts"))
sys.path.insert(0, os.path.join(SKILL, "server"))
import build_video_catalog as bvc  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
import videos  # noqa: E402

A, B, C, D = "aaaaaaaaaaa", "bbbbbbbbbbb", "-cccccccccc", "ddddddddddd"


def write(p, text=""):
    Path(p).parent.mkdir(parents=True, exist_ok=True)
    Path(p).write_text(text)


class CatalogBuild(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        d = self.t.name
        write(f"{d}/catalog/priority.json", json.dumps([
            {"id": A, "title": "Ultrasound-guided spinal | #anesthesia #shorts", "source": "NYSORA", "kind": "Video",
             "dur": 300, "views": 10, "priority": "Spinal & epidural"},
            {"id": B, "title": "Why this happens #tag1 #tag2", "source": "NYSORA", "kind": "Short", "dur": 40, "views": 5,
             "priority": "Regional & ultrasound"}]))
        write(f"{d}/catalog/rest-keep.json", json.dumps([
            {"id": A, "title": "duplicate", "source": "X", "kind": "Video", "dur": 1, "views": 1, "subject": "Airway", "format": "Teaching"},
            {"id": C, "title": "Pharmacology lecture", "source": "ABCs of Anaesthesia", "kind": "Video", "dur": 2400, "views": 1,
             "subject": "Pharmacology", "format": "Teaching"},
            {"id": D, "title": "Members only video", "source": "X", "kind": "Video", "dur": 700, "views": 1,
             "subject": "Airway", "format": "Teaching"}]))
        write(f"{d}/catalog/gallagher.tsv", "videos\tFzvWfuAEfwo\t376\t22000\tSwan Ganz Placement: presented by Dr. Gallagher's Neighborhood\n")
        write(f"{d}/catalog/stonybrook-extra-urls.txt", "https://www.youtube.com/watch?v=cr7IlA3zgFQ\n")
        write(f"{d}/download-x.log", f"ERROR: [youtube] {D}: Join this channel to get access to members-only content like this video\n")
        self.vids, self.blocked = bvc.build(f"{d}/catalog", d)
        self.by = {v["id"]: v for v in self.vids}

    def tearDown(self):
        self.t.cleanup()

    def test_members_only_excluded(self):
        self.assertNotIn(D, self.by)
        self.assertEqual(self.blocked, {D})

    def test_hashtags_stripped(self):
        self.assertEqual(self.by[A]["title"], "Ultrasound-guided spinal")
        self.assertEqual(self.by[B]["title"], "Why this happens")

    def test_dedupe_first_source_wins(self):
        self.assertEqual(sum(1 for v in self.vids if v["id"] == A), 1)
        self.assertEqual(self.by[A]["subject"], "Spinal & epidural")

    def test_formats_and_buckets(self):
        self.assertEqual(self.by[A]["format"], "Procedure")
        self.assertEqual(self.by[B]["format"], "Procedure")
        self.assertEqual(self.by[B]["length"], "Short")
        self.assertEqual(self.by[A]["length"], "Under 10 min")
        self.assertEqual(self.by[C]["length"], "30+ min")
        self.assertEqual(bvc.length_bucket("Video", 1200), "10–30 min")
        self.assertEqual(self.by[A]["tags"], ["Spinal & epidural", "Procedure", "NYSORA", "Under 10 min"])

    def test_hand_assigned_sources(self):
        self.assertEqual(self.by["FzvWfuAEfwo"]["subject"], "Vascular access & lines")
        self.assertEqual(self.by["cr7IlA3zgFQ"]["source"], "Stony Brook")
        self.assertEqual(self.by["cr7IlA3zgFQ"]["subject"], "Spinal & epidural")

    def test_idempotent(self):
        again, _ = bvc.build(os.path.join(self.t.name, "catalog"), self.t.name)
        self.assertEqual(self.vids, again)


class ServerBase(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.dir = Path(self.t.name) / "drive"
        self.dir.mkdir()
        self.cat = Path(self.t.name) / "videos.json"
        self.cat.write_text(json.dumps([{"id": A, "title": "one"}, {"id": B, "title": "two"}]))
        self.patches = [mock.patch.dict(os.environ, {"CHIRON_VIDEO_DIR": str(self.dir)}),
                        mock.patch.object(videos, "CATALOG", self.cat)]
        for p in self.patches:
            p.start()
        videos._cache.update(at=0.0, key=None, out=None)
        videos._jobs.clear()
        app = FastAPI()
        app.include_router(videos.router)
        self.c = TestClient(app)
        write(self.dir / A / f"{A}.mp4", "mp4data" * 10)
        write(self.dir / A / f"{A}.en.vtt", "WEBVTT")

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.t.cleanup()


class MediaRoute(ServerBase):
    def test_serves_allowed_files_with_range(self):
        r = self.c.get(f"/videos/media/{A}/{A}.mp4", headers={"Range": "bytes=0-6"})
        self.assertEqual(r.status_code, 206)
        self.assertEqual(r.content, b"mp4data")
        self.assertEqual(self.c.get(f"/videos/media/{A}/{A}.en.vtt").status_code, 200)

    def test_rejects_bad_requests(self):
        for url in ("/videos/media/short/short.mp4", f"/videos/media/{A}/other.mp4", f"/videos/media/{A}/{A}.json",
                    f"/videos/media/{B}/{B}.mp4", f"/videos/media/{A}/..%2f{A}.mp4", "/videos/media/..%2f..%2fetc/passwd",
                    f"/videos/media/{A}/%2e%2e%2f{A}.mp4"):
            self.assertEqual(self.c.get(url).status_code, 404, url)

    def test_symlink_escape_blocked(self):
        outside = Path(self.t.name) / "secret.mp4"
        outside.write_text("secret")
        os.makedirs(self.dir / B)
        os.symlink(outside, self.dir / B / f"{B}.mp4")
        self.assertEqual(self.c.get(f"/videos/media/{B}/{B}.mp4").status_code, 404)


class ApiVideos(ServerBase):
    def test_local_flags(self):
        d = self.c.get("/api/videos").json()
        by = {v["id"]: v for v in d["videos"]}
        self.assertTrue(d["drive_mounted"])
        self.assertTrue(by[A]["local"] and by[A]["vtt"] and not by[A]["thumb"])
        self.assertFalse(by[B]["local"])

    def test_unmounted_drive_is_not_an_error(self):
        with mock.patch.dict(os.environ, {"CHIRON_VIDEO_DIR": str(self.dir / "nope")}):
            videos._cache.update(at=0.0, key=None, out=None)
            d = self.c.get("/api/videos").json()
        self.assertFalse(d["drive_mounted"])
        self.assertFalse(any(v["local"] for v in d["videos"]))


class PhoneCopy(ServerBase):
    def wait(self, vid, state, secs=5):
        end = time.time() + secs
        while time.time() < end:
            st = self.c.get(f"/api/videos/{vid}/phone").json()
            if st["state"] == state:
                return st
            time.sleep(0.05)
        self.fail(f"never reached {state}: {st}")

    def test_command_is_exact_list(self):
        cmd = videos.ffmpeg_cmd(Path("/a/-b.mp4"), Path("/t/x.mp4"))
        self.assertEqual(cmd[:6], ["nice", "-n", "10", "ffmpeg", "-v", "error"])
        self.assertIn("scale=-2:480", cmd)
        self.assertEqual(cmd[-1], "/t/x.mp4")

    def test_encode_then_ready(self):
        def fake_run(cmd, **kw):
            Path(cmd[-1]).write_bytes(b"x" * 123)
            return mock.Mock(returncode=0, stderr="")
        with mock.patch.object(videos.subprocess, "run", side_effect=fake_run):
            self.assertEqual(self.c.get(f"/api/videos/{A}/phone").json()["state"], "none")
            self.assertIn(self.c.post(f"/api/videos/{A}/phone").json()["state"], ("queued", "encoding", "ready"))
            st = self.wait(A, "ready")
        self.assertEqual(st["bytes"], 123)
        self.assertEqual(self.c.get(f"/videos/phone/{A}.mp4").content, b"x" * 123)
        self.assertEqual(self.c.post(f"/api/videos/{A}/phone").json()["state"], "ready")

    def test_ffmpeg_failure_reports_error(self):
        with mock.patch.object(videos.subprocess, "run", return_value=mock.Mock(returncode=1, stderr="boom")):
            self.c.post(f"/api/videos/{A}/phone")
            st = self.wait(A, "error")
        self.assertIn("boom", st["error"])
        self.assertFalse(videos.phone_path(A).exists())

    def test_not_downloaded_and_bad_id(self):
        self.assertEqual(self.c.post(f"/api/videos/{B}/phone").status_code, 404)
        self.assertEqual(self.c.post("/api/videos/bad/phone").status_code, 404)
        self.assertEqual(self.c.get(f"/videos/phone/{B}.mp4").status_code, 404)

    def test_queue_bound_returns_429(self):
        full = queue.Queue(maxsize=videos.QUEUE_MAX)
        for i in range(videos.QUEUE_MAX):
            full.put_nowait(f"q{i:010d}")
        with mock.patch.object(videos, "_q", full), mock.patch.object(videos, "_ensure_worker"):
            self.assertEqual(self.c.post(f"/api/videos/{A}/phone").status_code, 429)
        self.assertEqual(videos.phone_status(A)["state"], "none")


if __name__ == "__main__":
    unittest.main()
