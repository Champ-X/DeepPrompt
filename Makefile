.PHONY: serve check verify browser-qa test

serve:
	python3 -m http.server 8765 --directory .

check: test
	python3 scripts/rebuild_archive.py --check
	python3 scripts/audit_annotation_coverage.py --check
	python3 scripts/verify_archive.py
	node scripts/browser_qa.mjs

verify: test
	python3 scripts/rebuild_archive.py --check
	python3 scripts/verify_archive.py

browser-qa:
	node scripts/browser_qa.mjs

test:
	python3 -m unittest discover -s scripts -p 'test_*.py'
