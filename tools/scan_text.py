# -*- coding: utf-8 -*-
"""扫描界面里偏解释性的文案，供人工决定是否删除。"""
import io
import re
import os

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

FILES = [
    r'android\assets\www\js\app.js',
    r'android\assets\www\js\ai.js',
    r'android\assets\www\js\import.js',
    r'android\assets\www\js\store.js',
]

KEY = (r'因为|所以|其实|注意|说明|无法|不允许|实现不了|不会|永远|而不是|本质|原理|'
       r'Gradle|ML Kit|方案|替代|一定|必须|建议|可能|只能|做不到|没办法|这里用|起因|'
       r'顺带|先说明|坦白|说实话')

pat = re.compile(r"'([^'\n]{18,})'")
seen = set()
rows = []

for rel in FILES:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        continue
    src = io.open(p, encoding='utf-8').read()
    for m in pat.finditer(src):
        s = m.group(1)
        cn = len(re.findall(r'[\u4e00-\u9fff]', s))
        if cn < 16:
            continue
        key = (rel, s)
        if key in seen:
            continue
        seen.add(key)
        if re.search(KEY, s):
            line = src[:m.start()].count('\n') + 1
            rows.append((rel, line, cn, s))

rows.sort(key=lambda r: (r[0], r[1]))
out = io.open(os.path.join(ROOT, 'text-scan.txt'), 'w', encoding='utf-8')
for rel, line, cn, s in rows:
    out.write('%s L%d [%d字] %s\n' % (os.path.basename(rel), line, cn, s))
out.write('---- 共 %d 条候选 ----\n' % len(rows))
out.close()
print('written: text-scan.txt  (%d)' % len(rows))
