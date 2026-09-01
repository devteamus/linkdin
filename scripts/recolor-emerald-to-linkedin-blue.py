#!/usr/bin/env python3
"""
Replace emerald-* color classes with LinkedIn-blue-equivalent classes
across the Dashboard and AdminPanel components, so the dashboard's
accent color matches the homepage (LinkedIn blue #0A66C2).

Mapping (Tailwind class → replacement):
  bg-emerald-600            → bg-[#0A66C2]
  hover:bg-emerald-700      → hover:bg-[#004182]
  hover:bg-emerald-600      → hover:bg-[#0A66C2]
  text-emerald-600          → text-[#0A66C2]
  hover:text-emerald-700    → hover:text-[#004182]
  text-emerald-700          → text-[#004182]
  bg-emerald-100            → bg-[#0A66C2]/10
  bg-emerald-50             → bg-[#0A66C2]/5
  border-emerald-500        → border-[#0A66C2]
  border-emerald-300        → border-[#0A66C2]/50
  hover:border-emerald-300  → hover:border-[#0A66C2]/50
  hover:border-emerald-400  → hover:border-[#0A66C2]/60
  bg-emerald-500            → bg-[#0A66C2]
  bg-emerald-600 text-white hover:bg-emerald-600  → bg-[#0A66C2] text-white hover:bg-[#0A66C2]

Order matters: longer matches first to avoid double-substitution.
"""
import re
import sys
from pathlib import Path

# Ordered list of (regex, replacement) tuples. Apply in order.
SUBSTITUTIONS = [
    # 3-part: bg-emerald-600 text-white hover:bg-emerald-600  (badge pattern)
    (r'bg-emerald-600 text-white hover:bg-emerald-600',
     'bg-[#0A66C2] text-white hover:bg-[#0A66C2]'),
    # hover:bg-emerald-700
    (r'hover:bg-emerald-700', 'hover:bg-[#004182]'),
    # hover:bg-emerald-600
    (r'hover:bg-emerald-600', 'hover:bg-[#0A66C2]'),
    # bg-emerald-600
    (r'bg-emerald-600', 'bg-[#0A66C2]'),
    # hover:text-emerald-700
    (r'hover:text-emerald-700', 'hover:text-[#004182]'),
    # text-emerald-700
    (r'text-emerald-700', 'text-[#004182]'),
    # text-emerald-600
    (r'text-emerald-600', 'text-[#0A66C2]'),
    # bg-emerald-100
    (r'bg-emerald-100', 'bg-[#0A66C2]/10'),
    # bg-emerald-50
    (r'bg-emerald-50', 'bg-[#0A66C2]/5'),
    # hover:border-emerald-400
    (r'hover:border-emerald-400', 'hover:border-[#0A66C2]/60'),
    # hover:border-emerald-300
    (r'hover:border-emerald-300', 'hover:border-[#0A66C2]/50'),
    # border-emerald-500
    (r'border-emerald-500', 'border-[#0A66C2]'),
    # border-emerald-300
    (r'border-emerald-300', 'border-[#0A66C2]/50'),
    # bg-emerald-500 (used for progress bars)
    (r'bg-emerald-500', 'bg-[#0A66C2]'),
    # ring-emerald-*
    (r'ring-emerald-500', 'ring-[#0A66C2]'),
    (r'ring-emerald-300', 'ring-[#0A66C2]/50'),
]


def transform(content: str) -> str:
    for pattern, replacement in SUBSTITUTIONS:
        content = re.sub(pattern, replacement, content)
    return content


def main() -> int:
    targets = [
        '/home/z/my-project/src/components/dashboard/Dashboard.tsx',
        '/home/z/my-project/src/components/admin/AdminPanel.tsx',
    ]
    total_changes = 0
    for path_str in targets:
        path = Path(path_str)
        if not path.exists():
            print(f'[skip] {path} does not exist')
            continue
        original = path.read_text(encoding='utf-8')
        transformed = transform(original)
        if original != transformed:
            # Count approximate substitutions for reporting
            approx = sum(
                len(re.findall(p, original)) for p, _ in SUBSTITUTIONS
            )
            path.write_text(transformed, encoding='utf-8')
            print(f'[updated] {path}  (~{approx} substitutions)')
            total_changes += approx
        else:
            print(f'[no-change] {path}')
    print(f'\nTotal substitutions: {total_changes}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
