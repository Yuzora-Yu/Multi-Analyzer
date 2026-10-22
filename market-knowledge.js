/* Public research notes, not market observations or fitted trading parameters. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.MultiAnalyzerMarketKnowledge=api;})(globalThis,function(){
  'use strict';
  const reviewedAt=Date.parse('2026-10-15T02:16:00Z');
  const ppiResultKnownAt=Date.parse('2026-10-15T13:06:10Z');
  const fedScheduleKnownAt=Date.parse('2026-10-16T03:07:59Z');
  const october16UpdateKnownAt=Date.parse('2026-10-16T13:09:30Z');
  const october20CalendarKnownAt=Date.parse('2026-10-20T05:00:39Z');
  const october21StateResultKnownAt=Date.parse('2026-10-20T21:00:44Z');
  const october22EarningsResultKnownAt=Date.parse('2026-10-21T17:00:53Z');
  const october22ClaimsScheduleKnownAt=Date.parse('2026-10-22T01:07:44Z');
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
    {id:'fed-calendar-oct2026',title:'FRB: Calendar October 2026',url:'https://www.federalreserve.gov/newsevents/2026-october.htm',kind:'発表機関の予定',knownAt:fedScheduleKnownAt,period:'10月15日23:30 EDT＝16日12:30 JST、IMFでの議長対談開始予定を確認。発言内容・結果は未取得。'},
    {id:'bls-import-202609',title:'BLS: September 2026 Import and Export Price Indexes',url:'https://www.bls.gov/news.release/ximpim.nr0.htm',kind:'発表機関の実績',knownAt:october16UpdateKnownAt,period:'2026年10月16日08:30 EDT公表。月次で更新される原本URLの9月実績を確認。過去月改定あり。予想値は未取得。'},
    {id:'fed-g17-oct2026',title:'FRB: October 2026 G.17 release schedule',url:'https://www.federalreserve.gov/newsevents/2026-october.htm',kind:'発表機関の予定',knownAt:october16UpdateKnownAt,period:'10月16日09:15 EDT＝22:15 JST、鉱工業生産・設備稼働率の公表予定を確認。実績・予想値は未取得。'},
    {id:'bls-calendar-20261020',title:'BLS: October 20–21, 2026 release schedule',url:'https://www.bls.gov/schedule/2026/10_sched.htm',kind:'発表機関の予定の再照合',knownAt:october20CalendarKnownAt,period:'10月20日と21日の10:00 EDT＝各23:00 JSTの掲載予定を確認。州別雇用と週間賃金。全国雇用統計ではなく、実績・予想値は未取得。'},
    {id:'bls-calendar-20261021',title:'BLS: October 20–21, 2026 schedule recheck',url:'https://www.bls.gov/schedule/2026/10_sched.htm',kind:'発表機関の予定の再照合',knownAt:october21StateResultKnownAt,period:'21日06:00 JSTに20・21日の10:00 EDT予定を再照合。21日通常週間賃金の結果はまだ未取得。'},
    {id:'bls-state-employment-202609',title:'BLS: September 2026 State Employment and Unemployment',url:'https://www.bls.gov/news.release/laus.nr0.htm',kind:'発表機関の実績',knownAt:october21StateResultKnownAt,period:'2026年10月20日10:00 EDT公表、21日06:00 JST確認。月次で更新される原本URLの9月州別資料。州推計は速報値を含み、後日改定され得る。全国雇用統計の再発表ではない。予想値は未取得。'},
    {id:'bls-calendar-20261022',title:'BLS: October 2026 schedule recheck on October 22',url:'https://www.bls.gov/schedule/2026/10_sched.htm',kind:'発表機関の予定の再照合',knownAt:october22EarningsResultKnownAt,period:'21日10:00 EDTの7～9月期通常週間賃金の掲載予定を再照合。BLS以外と突発材料を網羅せず、元の確認期限も延長しない。'},
    {id:'bls-weekly-earnings-2026q3',title:'BLS: Third Quarter 2026 Usual Weekly Earnings',url:'https://www.bls.gov/news.release/wkyeng.nr0.htm',kind:'発表機関の実績',knownAt:october22EarningsResultKnownAt,period:'2026年10月21日10:00 EDT公表、22日02:00 JST確認。四半期で更新される原本URLの7～9月期実績。季節調整前のフルタイム賃金・給与労働者の通常週収中央値。予想値は未取得。'},
    {id:'bls-calendar-20261022-morning',title:'BLS: October 2026 schedule, October 22 morning recheck',url:'https://www.bls.gov/schedule/2026/10_sched.htm',kind:'発表機関の予定の再照合',knownAt:october22ClaimsScheduleKnownAt,period:'22・23日にBLS掲載予定なし。BLS以外の予定や突発材料がないという意味ではない。'},
    {id:'dol-weekly-claims-clock',title:'DOL: Weekly Claims publication clock during email transition',url:'https://content.govdelivery.com/accounts/USDOL/bulletins/42c4a8a',kind:'発表機関の公表時刻',knownAt:october22ClaimsScheduleKnownAt,period:'DOLの案内は毎週木曜08:30 Eastern。10月22日はEDTで21:30 JST。メール移行中も公式PDFを公表する案内。22日の実績・予想値は未取得。'},
    {id:'dol-claims-schedule-2026',title:'DOL ETA: Weekly Claims schedule and holiday exceptions',url:'https://oui.doleta.gov/unemploy/archive.asp',kind:'発表機関の予定・休日例外',knownAt:october22ClaimsScheduleKnownAt,period:'毎週木曜の公表と2026年の休日例外を照合。10月22日の例外は掲載なし。一般欄のEST表記はDOLのEastern Time案内と夏時間を区別して適用。'}
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
      {id:'us-import-202609',name:'米輸出入物価（9月）',time:Date.parse('2026-10-16T12:30:00Z'),knownAt:reviewedAt,source:'bls-calendar',result:{knownAt:october16UpdateKnownAt,source:'bls-import-202609',text:'輸入物価 前月比+1.1％・前年比+8.1％、非燃料輸入 前月比+0.7％・前年比+6.0％。輸出物価 前月比+2.2％・前年比+11.6％。過去月改定あり。予想値・同時刻の金利とドルは未取得。価格変動の原因や売買方向は、この実績だけでは確定しません。'}},
      {id:'us-g17-202609',name:'米鉱工業生産・設備稼働率（9月）',time:Date.parse('2026-10-16T13:15:00Z'),knownAt:october16UpdateKnownAt,source:'fed-g17-oct2026'}
    ],reviews:[{
      verifiedAt:october20CalendarKnownAt,expiresAt:Date.parse('2026-10-22T05:00:39Z'),coverage:'partial',source:'bls-calendar-20261020',
      note:'BLSの10月20・21日の掲載予定を再照合した部分記録です。他省庁・地方連銀・各国・突発材料は未収録。掲載なしを指標なしと判断しません。実績・予想値は未取得。',events:[
        {id:'us-state-employment-202609',name:'米州別雇用・失業（9月、全国雇用統計とは別）',time:Date.parse('2026-10-20T14:00:00Z'),knownAt:october20CalendarKnownAt,source:'bls-calendar-20261020'},
        {id:'us-weekly-earnings-2026q3',name:'米通常週間賃金（2026年7～9月期）',time:Date.parse('2026-10-21T14:00:00Z'),knownAt:october20CalendarKnownAt,source:'bls-calendar-20261020'}
      ]
    },{
      verifiedAt:october21StateResultKnownAt,expiresAt:Date.parse('2026-10-22T05:00:39Z'),coverage:'partial',source:'bls-calendar-20261021',
      note:'BLSの20・21日の予定を再照合し、州別雇用の実績を個別の確認時刻で追記。元の期限は延長しません。他省庁・地方連銀・各国・突発材料は未収録。掲載なしを指標なしと判断しません。週間賃金の結果・予想値・同時刻の金利とドルは未取得。',events:[
        {id:'us-state-employment-202609',name:'米州別雇用・失業（9月、全国雇用統計とは別）',time:Date.parse('2026-10-20T14:00:00Z'),knownAt:october20CalendarKnownAt,source:'bls-calendar-20261020',result:{knownAt:october21StateResultKnownAt,source:'bls-state-employment-202609',text:'9月の失業率は5州で低下、45州とDCは概ね不変。非農業雇用は2州で増加、1州で減少、47州とDCは概ね不変。州推計は速報値を含み、後日改定され得ます。全国雇用統計の再発表ではありません。予想値・同時刻の金利とドルは未取得。この実績だけで金の方向や価格変動の原因は確定しません。'}},
        {id:'us-weekly-earnings-2026q3',name:'米通常週間賃金（2026年7～9月期）',time:Date.parse('2026-10-21T14:00:00Z'),knownAt:october20CalendarKnownAt,source:'bls-calendar-20261020'}
      ]
    }]};
  const priorEarningsCalendar=calendar.reviews.at(-1);
  calendar.reviews.push({...priorEarningsCalendar,verifiedAt:october22EarningsResultKnownAt,source:'bls-calendar-20261022',
    note:'BLS予定と7～9月期通常週間賃金の実績を再照合し、個別の確認時刻で追記。元の期限は延長しません。他省庁・地方連銀・各国・突発材料は未収録。掲載なしを指標なしと判断しません。予想値・同時刻の金利とドルは未取得。',
    events:priorEarningsCalendar.events.map(e=>e.id==='us-weekly-earnings-2026q3'?{...e,result:{knownAt:october22EarningsResultKnownAt,source:'bls-weekly-earnings-2026q3',text:'2026年7～9月期の通常週収中央値は1,232ドル、前年比+1.5％（季節調整前、フルタイム賃金・給与労働者）。同資料が比較する同期間のCPI-Uは+3.5％で、月次CPIの新規発表ではありません。予想値・同時刻の金利とドルは未取得。この実績だけで金の方向や価格変動の原因は確定しません。'}}:e)
  });
  calendar.reviews.push({verifiedAt:october22ClaimsScheduleKnownAt,expiresAt:Date.parse('2026-10-22T22:00:00Z'),coverage:'partial',source:'bls-calendar-20261022-morning',
    note:'BLS月間予定と22日のDOL週間失業保険の公表時刻・休日例外を照合した部分記録。DOLは08:30 Eastern＝本日21:30 JST。取得した公式PDFは15日版で、22日の実績・予想値は未取得。他の指標・発言・突発材料を網羅せず、掲載なしを安全とは判断しません。',
    events:[...calendar.reviews.at(-1).events,{id:'us-weekly-claims-20261022',name:'米週間失業保険申請（DOLの週間公表予定）',time:Date.parse('2026-10-22T12:30:00Z'),knownAt:october22ClaimsScheduleKnownAt,source:'dol-weekly-claims-clock'}]
  });
  function freeze(v){if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;}
  return freeze({version:'gold-context-knowledge-v1',reviewedAt,sources,principles,calendar,
    missing:['現在のドル・米2年/10年/実質金利','当日の地政学・要人発言の新規材料','最新の建玉・ETFフロー・実スプレッド'],
    scope:'公開資料の知識と条件付き観察シナリオ。SMC/P/EXIT・通知・固定デモ口座を変更しない。'});
});
