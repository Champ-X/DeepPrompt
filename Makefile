.PHONY: serve check verify browser-qa

serve:
	python3 -m http.server 8765 --directory .

check:
	python3 scripts/rebuild_archive.py --check
	python3 scripts/audit_annotation_coverage.py --check
	python3 scripts/verify_archive.py
	node scripts/browser_qa.mjs

verify:
	python3 scripts/rebuild_archive.py --check
	python3 scripts/verify_archive.py

browser-qa:
	node scripts/browser_qa.mjs
