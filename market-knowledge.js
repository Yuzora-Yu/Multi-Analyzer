/* Public research notes, not market observations or fitted trading parameters. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerMarketKnowledge=api;})(globalThis,function(){
  'use strict';
  const reviewedAt=Date.parse('2026-10-15T02:16:00Z');
  const ppiResultKnownAt=Date.parse('2026-10-15T13:06:10Z');
  const fedScheduleKnownAt=Date.parse('2026-10-16T03:07:59Z');
  const sources=[
    {id:'wgc-2026',title:'WGC: Gold Mid-Year Outlook 2026',url:'https://www.gold.org/goldhub/research/gold-mid-year-outlook-2026',kind:'期間を限定した金市場分析',period:'2026年上半期、6月26日まで。セッション分析はスポット金の20分価格。'},
    {id:'wgc-2024',title:'WGC: Let’s tally the rally',url:'https://www.gold.org/download/file/19260/let%27s-tally-the-rally.pdf',kind:'過去のセッション比較',period:'2024年1～10月。2026年版とは時間帯の区分も異なる。'},
    {id:'lbma-clock',title:'LBMA Gold Price FAQs',url:'https://www.lbma.org.uk/prices-and-data/lbma-gold-price/lbma-gold-price',kind:'制度・時刻',period:'AM 10:30 / PM 15:00、ロンドン現地時刻。'},
    {id:'sge-clock',title:'Shanghai Gold Exchange: Trading Hours',url:'https://en.sge.com.cn/h5_trading_ProductsIntroduce',kind:'取引所の制度・時刻',period:'日中取引9:00～15:30、上海現地時刻。休日の特別予定は別照合。'},
    {id:'frb-news',title:'FRB IFDP 823: High-Frequency Effects of US Data Releases',url:'https://www.federalreserve.gov/pubs/ifdp/2004/823/ifdp823.htm',kind:'外国為替の実証研究',period:'2004年論文。金の翌日方向の証明には流用しない。'},
    {id:'nber-regime',title:'NBER 19523: Time Variation in Asset Price Responses',url:'https://www.nber.org/papers/w19523',kind:'資産価格の実証研究',period:'2013年。景気・政策金利・リスク環境による反応差。'},
    {id:'cme-inflation',title:'CME: Do Retreating Precious Metals Prices Offer a Buying Opportunity?',url:'https://www.cmegroup.com/insights/economic-research/2026/do-retreating-precious-metals-prices-offer-a-buying-opportunity.html',kind:'取引所掲載の経済分析',period:'2026年の局面分析。著者の解釈であり普遍的な売買則ではない。'},
    {id:'wgc-geopolitics',title:'WGC: What’s the impact of geopolitics on gold?',url:'https://www.gold.org/goldhub/gold-focus/2023/10/you-asked-we-answered-whats-impact-of-geopolitics-on-gold',kind:'金の地政学・マクロ分析',period:'2023年、主に月次・週次。分足の方向・値幅には換算しない。'},
    {id:'cme-oi',title:'CME: Open Interest',url:'https://www.cmegroup.com/education/lessons/open-interest',kind:'市場構造の説明',period:'建玉と売買高の区別。足形から参加者の決済理由は特定できない。'},
    {id:'bls-calendar',title:'BLS: October 2026 release schedule',url:'https://www.bls.gov/schedule/2026/10_sched.htm',kind:'発表機関の予定',period:'BLS予定だけを確認。Fed・他省庁・各国・突発材料を網羅しない。'},
    {id:'bls-cpi',title:'BLS: September 2026 CPI',url:'https://www.bls.gov/news.release/archives/cpi_10142026.htm',kind:'発表機関の実績',period:'2026年10月14日08:30 ET公表。予想値の出典は含まない。'},
    {id:'bls-ppi',title:'BLS: September 2026 PPI',url:'https://www.bls.gov/news.release/ppi.nr0.htm',kind:'発表機関の実績',knownAt:ppiResultKnownAt,period:'2026年10月15日08:30 ET公表。月次で更新される原本URLの9月実績を確認。予想値の出典は含まない。'},
    {id:'fed-calendar-oct2026',title:'FRB: Calendar October 2026',url:'https://www.federalreserve.gov/newsevents/2026-october.htm',kind:'発表機関の予定',knownAt:fedScheduleKnownAt,period:'10月15日23:30 EDT＝16日12:30 JST、IMFでの議長対談開始予定を確認。発言内容・結果は未取得。'}
  ];
  const principles=[
    {id:'sessions',title:'時間帯の癖を相場環境と組み合わせる',finding:'2026年上半期のWGC分析ではアジアの反発・米国の下落が目立った。',use:'前セッション高安、上位足、当日の材料を重ねて戻り売り・押し目買いの観察順を決める。',limit:'期間限定の傾向。アジア＝常にレンジ、特定の時刻＝必ず下落、とはしない。',sources:['wgc-2026','wgc-2024'],evidence:'過去の観察'},
    {id:'clocks',title:'参加市場・値決めの切替を事前に見る',finding:'上海の日中開始とLBMAの値決めは、事前に時刻が分かる観察点。',use:'接近する時間に、それ以前の高安・SMC帯の突破と失敗を比較する。',limit:'時刻は売買方向を指定しない。夏時間と休日を分け、OTC市場の一斉開場とは扱わない。',sources:['lbma-clock','sge-clock'],evidence:'制度・運用仮説'},
    {id:'news',title:'指標は結果・予想差・市場反応を分ける',finding:'指標への反応はサプライズと政策・リスク環境に依存する。為替研究では初動の情報反映が速い。',use:'発表前終値と最初の15分・1時間の高安を保持し、翌セッションで回復か再拒否かを調べる。',limit:'翌日は必ず逆行・必ず続落という法則は採用しない。為替研究を金の勝率に変換しない。',sources:['frb-news','nber-regime'],evidence:'研究＋運用仮説'},
    {id:'inflation',title:'インフレと金利の伝達経路を読む',finding:'インフレ懸念による金需要と、引締め観測・ドルによる下押しは同時に起こり得る。',use:'総合とコア、予想との差、2年・10年・実質金利、ドルの変化を照合する。',limit:'CPI上振れだけで方向を確定しない。未取得の金利・ドルを上昇したことにしない。',sources:['cme-inflation'],evidence:'経済分析'},
    {id:'geopolitics',title:'地政学を複数の経路で評価する',finding:'安全需要に加え、原油・インフレ・政策・ドル・換金売りの経路も考える。',use:'出来事の発生時刻・確認時刻・新規性を付け、金利・ドル・金の実反応と比較する。',limit:'戦争＝常に金買い、とはしない。月次モデルから当日の目標価格を作らない。',sources:['wgc-geopolitics','cme-inflation'],evidence:'分析・条件依存'},
    {id:'positioning',title:'ポジション解消を足形だけで断定しない',finding:'建玉・売買高・価格は別の情報。上昇したことだけではショート利確だけと分からない。',use:'建玉や資金フローがあれば補助材料にし、価格の拒否・回復は観察事実として記述する。',limit:'Bybitの短い約定窓を世界全体の注文流や連続CVDと呼ばない。',sources:['cme-oi'],evidence:'市場構造'},
    {id:'practitioner',title:'実務の仮説も捨てず、条件を明示する',finding:'前セッション高安の掃き出し、指標後の行き過ぎと戻り、翌セッションの再評価を候補にする。',use:'SMCの拒否・構造変化とMA・BBの局所帯に重ね、成立・撤回の価格を先に決める。',limit:'ここは本ツールの検討仮説。文献が特定の入場法や収益性を証明したとは扱わない。',sources:[],evidence:'実務仮説・未検証'}
  ];
  const calendar={verifiedAt:reviewedAt,expiresAt:Date.parse('2026-10-17T02:16:00Z'),coverage:'partial',source:'bls-calendar',
    note:'掲載した一部予定を人が一次資料で確認。各予定の確認時刻は別管理。全経済予定・要人発言・突発ニュースの自動配信ではありません。',events:[
      {id:'us-cpi-202609',name:'米CPI（9月）',time:Date.parse('2026-10-14T12:30:00Z'),knownAt:reviewedAt,source:'bls-calendar',result:{knownAt:reviewedAt,source:'bls-cpi',text:'総合 前月比+0.6％・前年比+3.7％、コア 前月比+0.3％・前年比+2.6％。予想値・同時刻の金利とドルはこの背景データに未収録。'}},
      {id:'us-ppi-202609',name:'米PPI（9月）',time:Date.parse('2026-10-15T12:30:00Z'),knownAt:reviewedAt,source:'bls-calendar',result:{knownAt:ppiResultKnownAt,source:'bls-ppi',text:'総合（最終需要）前月比+1.3％（季節調整済）・前年比+6.3％（季節調整前）。食品・エネルギー・商業サービス除き前月比+0.5％・前年比+5.0％。速報値、過去月改定あり。予想値・同時刻の金利とドルは未取得。'}},
      {id:'fed-warsh-imf-20261016',name:'ウォーシュFRB議長・IMF対談（開始予定）',time:Date.parse('2026-10-16T03:30:00Z'),knownAt:fedScheduleKnownAt,source:'fed-calendar-oct2026'},
      {id:'us-import-202609',name:'米輸出入物価（9月）',time:Date.parse('2026-10-16T12:30:00Z'),knownAt:reviewedAt,source:'bls-calendar'}
    ]};
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  return freeze({version:'gold-context-knowledge-v1',reviewedAt,sources,principles,calendar,
    missing:['現在のドル・米2年/10年/実質金利','当日の地政学・要人発言の新規材料','最新の建玉・ETFフロー・実スプレッド'],
    scope:'公開資料の知識と条件付き観察シナリオ。SMC/P/EXIT・通知・固定デモ口座を変更しない。'});
});
