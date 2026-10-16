const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('retired market links cannot attach a BTC archive to the Gold workspace',()=>{
  const app=fs.readFileSync(require.resolve('../app.js'),'utf8');
  const part=app.slice(app.indexOf('  const INITIAL_PARAMS ='),app.indexOf('  const state ='));
  for(const query of ['?asset=btc&snapshot=btc-123-4.3.4&tf=1m','?asset=gold&snapshot=btc-123-4.3.4','?asset=btc&snapshot=gold-123-4.3.4']){
    const location={search:query,href:'https://app.test/'+query};let next;
    const params=vm.runInNewContext(part+';INITIAL_PARAMS',{URL,URLSearchParams,location,history:{replaceState(a,b,url){next=url;}}});
    assert.equal(params.has('snapshot'),false);assert.equal(params.has('asset'),false);
    assert.equal(next.searchParams.has('snapshot'),false);assert.equal(next.searchParams.has('asset'),false);
  }
  const query='?asset=gold&snapshot=gold-123-4.3.4';
  const params=vm.runInNewContext(part+';INITIAL_PARAMS',{URL,URLSearchParams,location:{search:query,href:'https://app.test/'+query},history:{replaceState(){throw Error('Gold archive must not change');}}});
  assert.equal(params.get('snapshot'),'gold-123-4.3.4');
});
test('active UI and comparison acquire only Gold without a hidden two-market switch',()=>{
  const html=fs.readFileSync(require.resolve('../index.html'),'utf8'),review=fs.readFileSync(require.resolve('../review-pack.js'),'utf8'),app=fs.readFileSync(require.resolve('../app.js'),'utf8');
  assert.doesNotMatch(html,/data-instrument="btc"|reviewBoth|BTC\/USD|BTC \/ USD/);
  assert.doesNotMatch(review,/reviewBoth/);assert.match(review,/collect\(\['gold'\]/);
  assert.match(app,/instrumentId: 'gold'/);
  const assets=app.slice(app.indexOf('  const INSTRUMENTS ='),app.indexOf('  const TF ='));
  assert.doesNotMatch(assets,/btc|BTC/);
});
