#!/bin/bash
#!/bin/bash
# ============================================================
# LEGACY BOOTSTRAP SCRIPT – READ BEFORE RUNNING
#
# This script was used to initialize afi-infra during the
# original infra/test patch. It is NOT intended for re-running
# blindly on existing clones.
#
# Before using this, review PATCH_SUMMARY.md and the current
# README to avoid overwriting or duplicating work.
# ============================================================
git init
git remote add origin git@github.com:AFI-Protocol/afi-infra.git
git add .
git commit -m "Initial commit for afi-infra"
git push -u origin main
