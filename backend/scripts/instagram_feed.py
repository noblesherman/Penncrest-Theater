#!/usr/bin/env python3
import argparse
import json
import sys
from datetime import timezone

import instaloader

MEDIA_TYPE_MAP = {
    "GraphImage": "IMAGE",
    "GraphVideo": "VIDEO",
    "GraphSidecar": "CAROUSEL_ALBUM",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch recent public Instagram posts via Instaloader.")
    parser.add_argument("--username", required=True, help="Public Instagram username")
    parser.add_argument("--limit", type=int, default=12, help="Number of posts to fetch")
    return parser.parse_args()


def to_iso8601(dt) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def get_media_url(post) -> str:
    if post.typename == "GraphVideo" and getattr(post, "video_url", None):
        return post.video_url
    return post.url


def get_thumbnail_url(post):
    if post.typename == "GraphVideo":
        return post.url
    return None


def normalize_post(post):
    media_type = MEDIA_TYPE_MAP.get(post.typename)
    if not media_type:
        return None

    media_url = get_media_url(post)
    if not media_url:
        return None

    shortcode = post.shortcode
    return {
        "id": str(post.mediaid),
        "shortcode": shortcode,
        "caption": post.caption or "",
        "mediaType": media_type,
        "mediaUrl": media_url,
        "thumbnailUrl": get_thumbnail_url(post),
        "permalink": f"https://www.instagram.com/p/{shortcode}/",
        "timestamp": to_iso8601(post.date_utc),
    }


def build_loader() -> instaloader.Instaloader:
    # This only reads metadata and media URLs. It does not download files.
    return instaloader.Instaloader(
        sleep=False,
        quiet=True,
        download_pictures=False,
        download_video_thumbnails=False,
        download_videos=False,
        download_geotags=False,
        download_comments=False,
        save_metadata=False,
        compress_json=False,
        max_connection_attempts=1,
    )


def main() -> int:
    args = parse_args()
    limit = max(1, args.limit)

    try:
        loader = build_loader()
        profile = instaloader.Profile.from_username(loader.context, args.username)

        items = []
        for post in profile.get_posts():
            normalized = normalize_post(post)
            if normalized is None:
                continue
            items.append(normalized)
            if len(items) >= limit:
                break

        print(json.dumps({"items": items}, separators=(",", ":"), ensure_ascii=False))
        return 0
    except Exception as exc:
        error_payload = {
            "error": {
                "type": exc.__class__.__name__,
                "message": str(exc) or "Failed to fetch Instagram feed via Instaloader.",
            }
        }
        print(json.dumps(error_payload, separators=(",", ":"), ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
