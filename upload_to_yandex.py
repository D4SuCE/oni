"""Upload a local audio file into one of your Yandex Music playlists.

Usage:
    set YANDEX_MUSIC_TOKEN=<oauth token>
    python upload_to_yandex.py "task/Akane Lize - Batsubyou.mp3" MyMp3Uploads
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request
import uuid

API = "https://api.music.yandex.net"


def request(url, token, data=None, headers=None, method=None):
    hdrs = {"Authorization": f"OAuth {token}", "X-Yandex-Music-Client": "YandexMusicAndroid/24023621"}
    hdrs.update(headers or {})
    req = urllib.request.Request(url, data=data, headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, timeout=300) as resp:
            body = resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code} on {url.split('?')[0]}: {e.read().decode('utf-8', 'replace')[:500]}")
    try:
        parsed = json.loads(body)
    except json.JSONDecodeError:
        return body
    return parsed.get("result", parsed) if isinstance(parsed, dict) else parsed


def multipart(field, filename, content):
    boundary = uuid.uuid4().hex
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        "Content-Type: audio/mpeg\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode()
    return head + content + tail, f"multipart/form-data; boundary={boundary}"


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    path, playlist_title = sys.argv[1], sys.argv[2]
    token = os.environ.get("YANDEX_MUSIC_TOKEN")
    if not token:
        sys.exit("YANDEX_MUSIC_TOKEN is not set")

    uid = request(f"{API}/account/status", token)["account"]["uid"]
    playlists = request(f"{API}/users/{uid}/playlists/list", token)
    matches = [p for p in playlists if p["title"] == playlist_title]
    if not matches:
        sys.exit(f"Playlist '{playlist_title}' not found. Have: {[p['title'] for p in playlists]}")
    playlist = matches[0]
    kind = playlist["kind"]
    print(f"Playlist '{playlist_title}' kind={kind}, tracks before: {playlist.get('trackCount')}")

    filename = os.path.basename(path)
    # Same call the official desktop app makes (LoaderResource.getUploadUrl).
    query = urllib.parse.urlencode({"uid": uid, "playlist-id": f"{uid}:{kind}", "path": filename})
    target = request(f"{API}/loader/upload-url?{query}", token, data=b"", method="POST")
    if target.get("result") == "TOO_MANY_FILES":
        sys.exit("Yandex refused: too many uploaded files on this account")
    post_target = target["post-target"]
    print(f"Upload slot received, ugc-track-id={target.get('ugc-track-id')}")

    with open(path, "rb") as f:
        body, ctype = multipart("file", filename, f.read())
    result = request(post_target, token, data=body, headers={"Content-Type": ctype}, method="POST")
    print(f"Upload response: {result}")

    # Yandex processes the file asynchronously; poll the playlist for a bit.
    for _ in range(12):
        time.sleep(10)
        info = request(f"{API}/users/{uid}/playlists/{kind}", token)
        print(f"tracks now: {info.get('trackCount')}")
        if info.get("trackCount", 0) > playlist.get("trackCount", 0):
            print("Track appeared in the playlist.")
            return
    print("Upload accepted, but the track hasn't shown up yet - processing may take a few more minutes.")


if __name__ == "__main__":
    main()
