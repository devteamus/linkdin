#!/usr/bin/env python3
"""
Create a downloadable ZIP of the PostGo project for local testing.

Includes:
  - All source files (src/, prisma/, public/, scripts/)
  - Configuration files (package.json, tsconfig.json, next.config.ts, etc.)
  - .env.example (renamed FROM .env so the user can fill in their own secrets)
  - README.md, Dockerfile, docker-compose.yml, Caddyfile
  - tailwind.config.ts, postcss.config.mjs, eslint.config.mjs, components.json
  - prisma/seed.ts and the test data seeder
  - tests/ folder (build scripts for the runtime container)

Excludes:
  - node_modules/ (user will run `bun install` locally)
  - .next/ (build artifacts)
  - .git/ (version control)
  - .zscripts/ (sandbox-only helper scripts)
  - db/ (SQLite database file — user will run `bun run db:push`)
  - dev.log, server.log (runtime logs)
  - download/ (only contains screenshots we took during verification)
  - upload/ (only contains the original input files)
  - tool-results/, worklog.md, postgo_extracted/, skills/, examples/, mini-services/
    (all sandbox-only directories)
  - .env (real env file with secrets — user fills in their own)
"""
import os
import zipfile
from pathlib import Path


PROJECT_ROOT = Path('/home/z/my-project')
OUTPUT_ZIP = Path('/home/z/my-project/download/postgo-linkedin-bulk-scheduler.zip')

# Directories to exclude entirely (relative or absolute names)
EXCLUDE_DIRS = {
    'node_modules', '.next', '.git', '.zscripts',
    'db', 'download', 'upload', 'tool-results',
    'postgo_extracted', 'skills', 'examples', 'mini-services',
    '.turbo', '.cache',
}

# Specific files to exclude
EXCLUDE_FILES = {
    '.env',  # user fills in their own copy from .env.example
    'dev.log', 'server.log',
    'worklog.md',
    '.DS_Store', 'Thumbs.db',
    'bun.lock',  # let bun regenerate for the user's local env
    'package-lock.json',
}


def should_skip(path: Path) -> bool:
    """Return True if this path should be excluded from the zip."""
    # Check each component of the path against the exclude list
    parts = path.relative_to(PROJECT_ROOT).parts
    for part in parts:
        if part in EXCLUDE_DIRS:
            return True
    if path.name in EXCLUDE_FILES:
        return True
    return False


def main() -> int:
    if not PROJECT_ROOT.exists():
        print(f'ERROR: project root {PROJECT_ROOT} does not exist')
        return 1

    # Make sure the download directory exists
    OUTPUT_ZIP.parent.mkdir(parents=True, exist_ok=True)

    file_count = 0
    total_size = 0

    with zipfile.ZipFile(OUTPUT_ZIP, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for root, dirs, files in os.walk(PROJECT_ROOT):
            root_path = Path(root)
            # Prune excluded directories in-place (so os.walk doesn't recurse into them)
            dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
            for fname in files:
                fpath = root_path / fname
                if should_skip(fpath):
                    continue
                # Compute archive name (relative path inside the zip)
                arcname = fpath.relative_to(PROJECT_ROOT).as_posix()
                # Put everything under a top-level `postgo/` folder so it unzips
                # into a clean subdirectory on the user's machine.
                arcname = f'postgo/{arcname}'
                zf.write(fpath, arcname)
                file_count += 1
                total_size += fpath.stat().st_size

    zip_size = OUTPUT_ZIP.stat().st_size
    print(f'Created: {OUTPUT_ZIP}')
    print(f'Files: {file_count}')
    print(f'Uncompressed size: {total_size / 1024:.1f} KB')
    print(f'Compressed zip size: {zip_size / 1024:.1f} KB')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
