"""Check exact ZIP contents and source/binary hashes without extracting files."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parent.parent
meta = json.loads((root / 'downloads/mt5-latest.json').read_text(encoding='utf-8'))
archive = root / 'downloads' / meta['file']
with zipfile.ZipFile(archive) as z:
    expected = set(meta['sourceFiles']) | {'MultiAnalyzerGold.ex5', 'manifest.json'}
    assert set(z.namelist()) == expected and len(z.namelist()) == len(expected)
    assert z.testzip() is None
    manifest = json.loads(z.read('manifest.json'))
    assert manifest['version'] == meta['version']
    assert manifest['compiler'] == {'errors': 0, 'warnings': 0}
    assert manifest['runtimeVerification'] == meta['runtimeVerification']
    for name in expected - {'manifest.json'}:
        digest = hashlib.sha256(z.read(name)).hexdigest()
        assert manifest['files'][name] == digest
        assert digest == (meta['compiledSha256'] if name.endswith('.ex5') else meta['sources'][name])
print(json.dumps({'archiveVerified': True, 'version': meta['version'], 'files': len(expected)}))
