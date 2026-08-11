"""
Cross-language interop check for gb2:

Decrypts browser-produced gb2: strings (from tests/interop-emit.mjs) using the
DELIVERED autograder crypto_utils.py, so the two ends of the pipeline are
proven against each other rather than against a shared assumption.

Usage:
    node tests/interop-emit.mjs > emitted.json
    python tests/interop-check.py emitted.json

Paths (override with env vars):
    GB2_FIXTURE          gb2_test_fixture.json          default ../Encryption/
    GB2_AUTOGRADER_DIR   dir containing crypto_utils.py default ../Encryption/updated_encryption_BA_7_13_2026

Requires: cryptography (pip install cryptography)
See tests/README.md.
"""
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
ENCRYPTION = REPO.parent / "Encryption"

fixture_path = Path(os.environ.get("GB2_FIXTURE") or ENCRYPTION / "gb2_test_fixture.json")
autograder_dir = Path(os.environ.get("GB2_AUTOGRADER_DIR") or ENCRYPTION / "updated_encryption_BA_7_13_2026")

if not fixture_path.exists():
    sys.exit(f"gb2 fixture not found at {fixture_path}\nSet GB2_FIXTURE to its location.")
if not (autograder_dir / "crypto_utils.py").exists():
    sys.exit(f"crypto_utils.py not found in {autograder_dir}\nSet GB2_AUTOGRADER_DIR to its location.")

fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
# The autograder reads the course private key from the environment. In production
# this is a Gradescope secret; here it is the throwaway fixture key.
os.environ["GB2_PRIVATE_KEY_PEM"] = fixture["private_key_pkcs8_pem"]

sys.path.insert(0, str(autograder_dir))
import crypto_utils  # noqa: E402

emitted = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  PASS  " if cond else "  FAIL  ") + name)
    if not cond:
        fails += 1
        if detail:
            print(f"          {detail}")


print("\ngb2 interop: browser cryptoService.ts -> autograder crypto_utils.py\n")
print(f"  crypto_utils: {crypto_utils.__file__}")
print(f"  fixture:      {fixture_path}\n")

check("is_encoded() recognises the browser gb2 string",
      crypto_utils.is_encoded(emitted["clean"]))

got = crypto_utils.decrypt_json(emitted["fixtureExact"])
check("decrypt_json() round-trips the fixture plaintext",
      got == emitted["fixturePlaintext"], f"got {got!r}")

got = crypto_utils.decrypt_json(emitted["clean"])
check("decrypt_json() round-trips the de-identified App.tsx payload",
      got == emitted["appPayload"], f"got {got!r}")

check("decrypted payload has no PII fields",
      not any(f in got for f in ("student_name", "email", "sid", "student_id")),
      f"keys: {sorted(got)}")

check("decrypted payload has assignment_id and submission_data",
      "assignment_id" in got and "submission_data" in got, f"keys: {sorted(got)}")

try:
    crypto_utils.decrypt_json(emitted["tampered"])
    check("tampered ciphertext raises", False, "decrypt_json returned normally")
except Exception as exc:
    check("tampered ciphertext raises", True)
    print(f"          ({type(exc).__name__}: {str(exc)[:70]})")

print(f"\n{'ALL INTEROP CHECKS PASSED' if fails == 0 else f'{fails} INTEROP CHECK(S) FAILED'}\n")
sys.exit(1 if fails else 0)
