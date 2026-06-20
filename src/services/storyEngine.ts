import { estimateTokens } from './tokenizer'
import {
  type ChapterCommit,
  type ChapterContract,
  type StoryEvent,
  type StoryMemoryCategory,
  type StoryProject,
  type StoryReviewIssue,
  type StoryStrand,
  useAppStore,
} from '../stores/useAppStore'

export type GenrePack = {
  id: string
  name: string
  gradeLevel?: 'middle_school' | 'university'
  essayType?: 'narrative' | 'expository' | 'argumentative' | 'prose' | 'commentary'
  pacing: string
  hooks: string[]
  risks: string[]
  sceneCraft: string[]
  antiPatterns: string[]
  characterArchetypes: string[]
  openingPatterns: string[]
  reviewFocus: string[]
  materialBank: string[]
  structureTemplates?: string[]
  commonPrompts?: string[]
  sampleMaterials?: string[]
  scoringRubric?: string[]
  forbiddenCliches?: string[]
}

export type StoryBrief = {
  project: StoryProject
  chapter: ChapterContract
  briefText: string
}

export const genrePacks: GenrePack[] = [
  {
    id: 'xianxia',
    name: '修仙/玄幻',
    pacing: '目标-代价-突破-新债务，能力兑现必须有代价和冷却。',
    hooks: ['境界门槛', '旧敌压迫', '秘境规则', '师承债务'],
    risks: ['战力膨胀', '法宝万能', '主角无代价获胜'],
    sceneCraft: ['战斗先写规则再写破局', '突破要有身体反应和外部压力'],
    antiPatterns: ['不要把境界名当剧情', '不要用连续顿悟解决所有冲突'],
    characterArchetypes: ['藏锋主角', '代价型导师', '资源守门人', '镜像竞争者'],
    openingPatterns: ['低位压力开场', '规则测试开场', '旧债追索开场'],
    reviewFocus: ['战力边界', '能力代价', '修炼规则', '爽点兑现'],
    materialBank: ['宗门试炼', '坊市交易', '秘境残卷', '师门旧约'],
  },
  {
    id: 'fantasy',
    name: '玄幻/异世大陆',
    pacing: '世界规则与人物命运同步展开，升级不是目的，选择与代价才是推进器。',
    hooks: ['血脉秘密', '王朝裂缝', '远古遗迹', '禁忌力量'],
    risks: ['设定堆砌', '地图无意义扩大', '反派只负责压迫'],
    sceneCraft: ['用仪式、地貌、阶层写世界差异', '每次力量展示都留下新限制'],
    antiPatterns: ['不要用专有名词轰炸读者', '不要让旁白替角色做决定'],
    characterArchetypes: ['失落继承者', '边境流亡者', '秩序维护者', '远古见证人'],
    openingPatterns: ['被驱逐的仪式现场', '边境异象', '遗物苏醒'],
    reviewFocus: ['世界规则稳定', '地图推进意义', '反派动机'],
    materialBank: ['封印仪式', '王庭审判', '边城集市', '古战场遗迹'],
  },
  {
    id: 'gaowu',
    name: '高武',
    pacing: '训练、比赛、实战、社会资源形成闭环，强度升级必须可量化。',
    hooks: ['体测排名', '武馆名额', '异兽警报', '家族资源差'],
    risks: ['数值升级空转', '训练无反馈', '配角工具化'],
    sceneCraft: ['用成绩、伤痛、资源消耗写进步', '战斗写判断与节奏差'],
    antiPatterns: ['不要连续报属性面板', '不要让胜利没有损耗'],
    characterArchetypes: ['寒门训练狂', '天才对照组', '严苛教练', '实战老兵'],
    openingPatterns: ['体测失利', '实战救场', '资源被截'],
    reviewFocus: ['训练反馈', '战斗可读性', '社会资源逻辑'],
    materialBank: ['校队选拔', '荒野实训', '武馆赌约', '联赛资格'],
  },
  {
    id: 'history',
    name: '历史/历史脑洞',
    pacing: '史实锚点清楚，人物选择推动局势变化，避免百科式叙述。',
    hooks: ['朝局危机', '军粮财政', '人物误判', '制度缝隙'],
    risks: ['现代口号穿帮', '史实与虚构边界混乱', '只讲背景不演场景'],
    sceneCraft: ['用具体官署、军营、街市承载历史压力', '先写人怎样被时代逼迫'],
    antiPatterns: ['不要长段堆资料', '不要让角色说出作者论文'],
    characterArchetypes: ['失势官员', '边军将领', '账房幕僚', '夹缝士人'],
    openingPatterns: ['军报入城', '朝堂争执', '粮饷断裂'],
    reviewFocus: ['史实锚点', '时代语言', '制度压力', '场景化叙述'],
    materialBank: ['漕运粮饷', '边关军报', '党争奏疏', '市井传闻'],
  },
  {
    id: 'historical_alt',
    name: '历史脑洞/架空',
    pacing: '一个改变量撬动制度连锁反应，爽点来自“选择改变局势”。',
    hooks: ['关键人物提前觉醒', '技术/制度微创新', '情报误差', '历史节点倒计时'],
    risks: ['金手指过大', '历史人物扁平化', '蝴蝶效应无成本'],
    sceneCraft: ['先写制度阻力，再写改良方案', '让反对者也有合理利益'],
    antiPatterns: ['不要现代方案一落地就成功', '不要让所有古人降智'],
    characterArchetypes: ['改革执行者', '保守派能臣', '草根技术人', '现实主义君主'],
    openingPatterns: ['历史节点前夜', '失败方案重来', '小技术进入大局'],
    reviewFocus: ['改变量边界', '制度反馈', '人物利益'],
    materialBank: ['火器改良', '税制改革', '地方治理', '军队整编'],
  },
  {
    id: 'period',
    name: '古言/宫斗',
    pacing: '关系压力与利益选择并行，每场戏至少改变一条关系线。',
    hooks: ['礼法限制', '内宅暗线', '错位信息', '情感代价'],
    risks: ['全靠误会', '反派降智', '礼制不稳定'],
    sceneCraft: ['对白带潜台词', '动作与称谓体现权力差'],
    antiPatterns: ['不要让所有角色同一种腔调', '不要用解释替代试探'],
    characterArchetypes: ['克制女主', '门第压力者', '温柔盟友', '体面反派'],
    openingPatterns: ['宴席试探', '家书抵达', '规矩冲突'],
    reviewFocus: ['礼制一致', '关系张力', '对白潜台词'],
    materialBank: ['请安礼', '内宅账册', '婚约流言', '家族祠堂'],
  },
  {
    id: 'palace',
    name: '宫斗宅斗',
    pacing: '信息差、规矩、资源、情感债共同推进，每步胜利都制造新风险。',
    hooks: ['请安变故', '赏赐暗示', '流言陷阱', '后位资源'],
    risks: ['阴谋太巧', '角色全员恶人', '权力规则混乱'],
    sceneCraft: ['用称谓、座次、赏罚写权力', '每句好话都要有目的'],
    antiPatterns: ['不要用旁白解释阴谋全貌', '不要让女主永远预判一切'],
    characterArchetypes: ['隐忍求生者', '体面掌权者', '利益同盟', '笑面竞争者'],
    openingPatterns: ['晨昏定省', '赏赐名单', '宴前换物'],
    reviewFocus: ['权力规则', '信息差公平', '人物动机'],
    materialBank: ['宫宴座次', '药方账本', '赏赐纹样', '嬷嬷传话'],
  },
  {
    id: 'suspense',
    name: '悬疑/规则怪谈',
    pacing: '线索-误导-验证-反转，读者必须能回看出公平性。',
    hooks: ['异常规则', '缺失证词', '不可靠叙述', '倒计时'],
    risks: ['线索后补', '谜底靠超自然硬解', '规则变来变去'],
    sceneCraft: ['每个线索同时服务事实和情绪', '关键证据要有二次含义'],
    antiPatterns: ['不要用“突然想起”破案', '不要把恐惧写成形容词堆砌'],
    characterArchetypes: ['带伤调查者', '不可靠证人', '隐藏受害者', '秩序维护者'],
    openingPatterns: ['异常现场', '缺失时间', '证词矛盾'],
    reviewFocus: ['线索公平', '误导合理', '谜底可回看'],
    materialBank: ['监控盲区', '旧报纸', '门禁记录', '反常习惯'],
  },
  {
    id: 'rules_mystery',
    name: '规则怪谈',
    pacing: '规则发现、试错、代价、规则重解形成循环，恐惧来自边界不确定。',
    hooks: ['第一条规则', '违规代价', '安全区失效', '规则冲突'],
    risks: ['规则随意改', '只靠血腥吓人', '主角试错无成本'],
    sceneCraft: ['用普通物件制造异常', '每条规则都要有可验证后果'],
    antiPatterns: ['不要把规则写成谜语合集', '不要靠旁白宣布恐怖'],
    characterArchetypes: ['谨慎观察者', '冲动破坏者', '规则原住民', '伪装引导者'],
    openingPatterns: ['醒来读规则', '第一次违规', '熟人异常'],
    reviewFocus: ['规则稳定', '代价明确', '悬念递进'],
    materialBank: ['宿舍守则', '地铁广播', '医院值班表', '游乐园地图'],
  },
  {
    id: 'realistic',
    name: '现实题材',
    pacing: '具体困境、利益结构和人物选择比口号更重要。',
    hooks: ['家庭债务', '职业瓶颈', '城市资源', '阶层误差'],
    risks: ['议论文腔', '人物只代表观点', '问题被轻易解决'],
    sceneCraft: ['用账单、通勤、饭桌、会议写压力', '每个选择都要付代价'],
    antiPatterns: ['不要替读者总结主题', '不要把人物写成新闻案例'],
    characterArchetypes: ['夹心层青年', '沉默父母', '现实主义朋友', '制度执行者'],
    openingPatterns: ['账单到期', '面试失败', '饭桌沉默'],
    reviewFocus: ['现实细节', '人物复杂度', '问题解决成本'],
    materialBank: ['租房合同', '医院排队', '绩效会议', '家庭转账记录'],
  },
  {
    id: 'romance',
    name: '狗血/现言',
    pacing: '情绪误差、亲密拉扯和代价升级形成连续张力。',
    hooks: ['身份错位', '旧爱回潮', '秘密曝光', '关系债务'],
    risks: ['只虐不变', '误会无法自洽', '角色缺少自尊边界'],
    sceneCraft: ['亲密戏写动作距离和话外音', '争吵要暴露真实欲望'],
    antiPatterns: ['不要让角色反复说同一个痛点', '不要用偶然偷听推动一切'],
    characterArchetypes: ['高自尊女主', '边界感男主', '旧关系债主', '清醒旁观者'],
    openingPatterns: ['重逢错位', '共同危机', '旧物出现'],
    reviewFocus: ['情绪递进', '误会自洽', '人物边界'],
    materialBank: ['雨夜车站', '合同关系', '旧短信', '家庭聚会'],
  },
  {
    id: 'modern_romance',
    name: '现言/职场婚恋',
    pacing: '职业目标与亲密关系互相挤压，选择让人物更成熟而非只更痛苦。',
    hooks: ['项目危机', '前任同场', '家庭催促', '职业机会'],
    risks: ['职场悬浮', '爱情覆盖全部人生', '女性成长只靠恋爱'],
    sceneCraft: ['用会议、邮件、差旅写关系变化', '冲突要同时伤到事业与感情'],
    antiPatterns: ['不要把霸总当万能解决方案', '不要让职场只当背景板'],
    characterArchetypes: ['专业型女主', '合作型伴侣', '竞争同事', '现实家人'],
    openingPatterns: ['项目汇报翻车', '差旅重逢', '升职名单公布'],
    reviewFocus: ['职业真实感', '亲密边界', '成长弧线'],
    materialBank: ['OKR 会议', '客户提案', '合租生活', '家族饭局'],
  },
  {
    id: 'scifi',
    name: '科幻',
    pacing: '概念必须进入人物选择，技术限制要稳定。',
    hooks: ['系统边界', '伦理困境', '未知信号', '资源倒计时'],
    risks: ['概念先行人物空心', '技术万能', '设定临时改口'],
    sceneCraft: ['用操作细节展示技术限制', '让概念改变关系和利益'],
    antiPatterns: ['不要连续说明书式科普', '不要用新设定逃避旧问题'],
    characterArchetypes: ['工程师主角', '伦理审查者', '失控系统', '边缘殖民者'],
    openingPatterns: ['信号异常', '实验事故', '资源警报'],
    reviewFocus: ['概念进入选择', '技术边界', '伦理困境'],
    materialBank: ['AI 审计日志', '太空舱故障', '基因协议', '城市传感网'],
  },
  {
    id: 'apocalypse',
    name: '末世',
    pacing: '生存资源、群体信任和道德边界连续升级，爽点来自艰难秩序重建。',
    hooks: ['断电断网', '避难所名额', '感染规则', '物资背叛'],
    risks: ['囤货流水账', '人性黑暗单一化', '危险无规则'],
    sceneCraft: ['用水、药、燃料写压力', '让信任成本可见'],
    antiPatterns: ['不要只写抢物资', '不要让主角仓库解决一切'],
    characterArchetypes: ['资源组织者', '医疗角色', '秩序破坏者', '带孩子的幸存者'],
    openingPatterns: ['城市停摆第一夜', '超市冲突', '避难所门口'],
    reviewFocus: ['资源逻辑', '群体关系', '危险规则'],
    materialBank: ['药品清单', '社区公告', '发电机燃油', '临时营地'],
  },
  {
    id: 'infinite',
    name: '无限流',
    pacing: '副本规则、团队分工、奖励代价和主线真相并行推进。',
    hooks: ['副本任务', '身份牌', '隐藏规则', '队友背叛'],
    risks: ['副本像换皮', '规则不公平', '奖励破坏平衡'],
    sceneCraft: ['每个副本有独立主题与情绪', '团队角色要互补冲突'],
    antiPatterns: ['不要只靠系统播报', '不要让主角独占全部解法'],
    characterArchetypes: ['冷静解谜者', '武力担当', '社交伪装者', '隐藏老玩家'],
    openingPatterns: ['任务播报', '陌生房间醒来', '第一位淘汰者'],
    reviewFocus: ['规则公平', '团队作用', '主线推进'],
    materialBank: ['酒店副本', '校园副本', '列车副本', '剧院副本'],
  },
  {
    id: 'urban',
    name: '都市/异能',
    pacing: '日常压迫和非常能力交替推进，爽点必须落到现实关系。',
    hooks: ['身份隐藏', '资源争夺', '能力副作用', '城市暗线'],
    risks: ['能力无边界', '配角只负责震惊', '现实成本消失'],
    sceneCraft: ['让能力改变工作、家庭、金钱或身份处境', '爽点前先建立压力'],
    antiPatterns: ['不要满屏震惊', '不要把升级当唯一剧情'],
    characterArchetypes: ['普通打工人', '隐藏管理者', '能力代价承担者', '城市调查者'],
    openingPatterns: ['通勤异常', '能力失控', '工作危机'],
    reviewFocus: ['能力边界', '现实成本', '城市质感'],
    materialBank: ['地铁早高峰', '写字楼加班', '旧城改造', '夜市冲突'],
  },
  {
    id: 'urban_daily',
    name: '都市日常',
    pacing: '日常细节与微小目标驱动，情绪价值来自真实关系和生活质感。',
    hooks: ['搬家第一天', '小店开张', '邻里误会', '职业转折'],
    risks: ['流水账', '无目标', '治愈变成口号'],
    sceneCraft: ['用食物、天气、物件写关系', '每章解决一个小问题并留下新牵挂'],
    antiPatterns: ['不要用鸡汤收尾', '不要让日常没有选择'],
    characterArchetypes: ['慢热店主', '嘴硬邻居', '返乡青年', '生活观察者'],
    openingPatterns: ['清晨开店', '雨天相遇', '旧物整理'],
    reviewFocus: ['生活质感', '微冲突', '情绪余味'],
    materialBank: ['早餐铺', '社区菜市场', '出租屋', '旧照片'],
  },
  {
    id: 'middle_narrative',
    name: '中学记叙文',
    gradeLevel: 'middle_school',
    essayType: 'narrative',
    pacing: '事件要小而具体，情感变化要由细节推动，结尾点题但不喊口号。',
    hooks: ['成长瞬间', '亲情友情', '校园生活', '挫折反思'],
    risks: ['素材空泛', '开头万能排比', '结尾强行升华', '人物像符号'],
    sceneCraft: ['抓一个动作、一个物件、一句对话', '用环境烘托心情变化', '首尾照应'],
    antiPatterns: ['不要写“那一次我懂得了很多”', '不要把老师父母写成完美说教者'],
    characterArchetypes: ['认真但不完美的我', '沉默支持者', '同桌朋友', '严格老师'],
    openingPatterns: ['一个物件引出回忆', '冲突现场开场', '雨声/铃声切入'],
    reviewFocus: ['事件完整', '细节真实', '情感转折', '点题自然'],
    materialBank: ['错题本', '运动会接力棒', '母亲的便签', '晚自习灯光', '公交卡'],
    structureTemplates: ['物件引入-冲突-细节-转折-照应', '场景开头-回忆展开-当下顿悟'],
    commonPrompts: ['难忘的一件事', '那一刻我长大了', '身边的温暖', '一次挫折'],
    sampleMaterials: ['雨天送伞不写伞，写鞋边泥点和递伞时的停顿', '失败后不写哭，写把号码布折了又展开'],
    scoringRubric: ['中心明确', '选材真实', '描写具体', '结构完整', '语言自然'],
    forbiddenCliches: ['阳光总在风雨后', '世上只有妈妈好式空泛抒情', '开头题记堆名言'],
  },
  {
    id: 'middle_expository',
    name: '中学说明文',
    gradeLevel: 'middle_school',
    essayType: 'expository',
    pacing: '对象特征先清楚，再按空间、时间或逻辑顺序展开，语言准确克制。',
    hooks: ['生活科技', '传统文化', '校园观察', '自然现象'],
    risks: ['像百科复制', '说明顺序混乱', '例子和对象无关'],
    sceneCraft: ['先定义对象，再分特征说明', '用举例、列数字、作比较增强清晰度'],
    antiPatterns: ['不要堆冷知识', '不要在说明文里长篇抒情'],
    characterArchetypes: ['观察者', '讲解者', '使用者', '改良者'],
    openingPatterns: ['从生活问题引入', '从一个现象提问', '从对象外观切入'],
    reviewFocus: ['对象明确', '顺序清晰', '方法恰当', '语言准确'],
    materialBank: ['校园图书馆', '智能手表', '非遗剪纸', '城市地铁', '节气变化'],
    structureTemplates: ['定义-特征一-特征二-用途-总结', '现象-原因-过程-影响'],
    commonPrompts: ['介绍一种事物', '说明一种传统技艺', '身边的科技', '校园一角'],
    sampleMaterials: ['说明图书馆可按位置、功能、人流三个层次展开', '说明节气可写天象、农事、生活习俗'],
    scoringRubric: ['特征准确', '顺序合理', '说明方法丰富', '语言简明'],
    forbiddenCliches: ['盲目引用网络百科', '结尾硬升华到祖国强大'],
  },
  {
    id: 'middle_argument',
    name: '中学议论文',
    gradeLevel: 'middle_school',
    essayType: 'argumentative',
    pacing: '中心论点明确，分论点递进，论据贴近生活与经典材料，结尾回应现实。',
    hooks: ['成长选择', '坚持与方法', '责任担当', '科技与自律'],
    risks: ['只喊观点', '名人论据滥用', '正反对比无分析'],
    sceneCraft: ['每个论据后必须解释“为什么证明论点”', '用正反对比或递进结构展开'],
    antiPatterns: ['不要万能套用司马迁/爱迪生', '不要三段都是同一个意思'],
    characterArchetypes: ['勤奋者', '反思者', '承担责任者', '理性使用科技者'],
    openingPatterns: ['现象引入论点', '设问引入', '对比引入'],
    reviewFocus: ['论点清楚', '论据有效', '分析充分', '结构递进'],
    materialBank: ['班级合作', '体育训练', '阅读积累', '志愿服务', '手机自律'],
    structureTemplates: ['提出论点-三个分论点-反面补充-总结', '现象-问题-原因-做法'],
    commonPrompts: ['谈坚持', '说责任', '自律的意义', '平凡与伟大'],
    sampleMaterials: ['用校队训练说明坚持要有方法', '用志愿服务说明责任来自具体行动'],
    scoringRubric: ['观点鲜明', '材料充实', '论证合理', '语言有力'],
    forbiddenCliches: ['空喊奋斗', '堆名言不分析', '结尾“让我们一起……”'],
  },
  {
    id: 'university_narrative',
    name: '大学记叙/散文',
    gradeLevel: 'university',
    essayType: 'prose',
    pacing: '经验、观察和自我认知交织，表达克制，避免青春疼痛模板。',
    hooks: ['自我认知', '专业成长', '城市经验', '社会实践'],
    risks: ['情绪自嗨', '抽象概念太多', '经历缺少反思'],
    sceneCraft: ['用城市空间、专业细节、一次具体交流承载主题', '反思要来自事件后果'],
    antiPatterns: ['不要写成朋友圈长文', '不要用“迷茫”覆盖全部细节'],
    characterArchetypes: ['初入专业者', '实习观察者', '离乡大学生', '社团组织者'],
    openingPatterns: ['一次实习现场', '城市夜归', '实验/课堂失败'],
    reviewFocus: ['经验具体', '反思克制', '结构自然', '语言清爽'],
    materialBank: ['第一次组会', '支教课堂', '实习工位', '城市通勤', '社团散场'],
    structureTemplates: ['场景-经验-反思-回到场景', '问题-行动-失败-再理解'],
    commonPrompts: ['我的大学生活', '社会实践感悟', '专业认知', '城市与我'],
    sampleMaterials: ['写支教不只写感动，写备课失败和学生追问', '写实习不只写忙，写一次被退回的方案'],
    scoringRubric: ['真实经验', '思想深度', '表达克制', '结构完整'],
    forbiddenCliches: ['青春不散场', '迷茫但热爱', '诗化空话堆叠'],
  },
  {
    id: 'university_expository',
    name: '大学说明/科普',
    gradeLevel: 'university',
    essayType: 'expository',
    pacing: '概念解释、案例拆解、数据意识和引用规范并重，让非专业读者也能理解。',
    hooks: ['概念误解', '生活案例', '跨学科材料', '数据变化'],
    risks: ['术语密度过高', '引用无来源', '案例不能支撑概念'],
    sceneCraft: ['先给直观定义，再说明机制、案例和边界', '复杂概念用类比但保留限制'],
    antiPatterns: ['不要把科普写成论文摘要', '不要用未经验证的数据'],
    characterArchetypes: ['研究者', '使用者', '反对者', '受影响群体'],
    openingPatterns: ['从误解提问', '从数据现象进入', '从生活痛点进入'],
    reviewFocus: ['定义准确', '案例清楚', '引用规范', '边界意识'],
    materialBank: ['生成式 AI', '睡眠科学', '城市更新', '碳中和', '心理健康'],
    structureTemplates: ['概念-机制-案例-争议-边界', '问题-现象-解释-建议'],
    commonPrompts: ['解释一个专业概念', '科普一项技术', '说明一个社会现象'],
    sampleMaterials: ['解释 AI 幻觉可用“自信但未核验的回答”类比', '说明碳中和要区分排放、抵消和减排'],
    scoringRubric: ['准确性', '可理解性', '材料可信', '结构清晰'],
    forbiddenCliches: ['数据来源不明', '把复杂问题归因于单一原因'],
  },
  {
    id: 'university_argument',
    name: '大学议论文/评论',
    gradeLevel: 'university',
    essayType: 'commentary',
    pacing: '问题意识先行，观点、证据、反驳和现实建议形成闭环。',
    hooks: ['公共议题', '技术伦理', '教育与就业', '文化消费'],
    risks: ['立场先行证据不足', '只批评不建设', '概念偷换'],
    sceneCraft: ['先界定问题范围，再给证据和反方观点', '反驳后提出可执行建议'],
    antiPatterns: ['不要用情绪替代论证', '不要把复杂群体标签化'],
    characterArchetypes: ['政策受影响者', '平台参与者', '普通学生', '专业从业者'],
    openingPatterns: ['公共事件引入', '数据矛盾引入', '概念辨析引入'],
    reviewFocus: ['问题边界', '论证链条', '反驳质量', '现实可行性'],
    materialBank: ['AI 与教育', '就业焦虑', '短视频文化', '城市公共空间', '算法推荐'],
    structureTemplates: ['问题界定-观点-证据-反方-回应-建议', '现象-原因-影响-方案'],
    commonPrompts: ['谈技术与人', '大学生就业', '公共空间治理', '算法时代的选择'],
    sampleMaterials: ['讨论 AI 写作要区分辅助学习和替代思考', '讨论就业焦虑要同时看个人选择与结构变化'],
    scoringRubric: ['观点独立', '证据充分', '反驳有效', '表达严谨'],
    forbiddenCliches: ['站队式评论', '网络热词堆砌', '宏大口号无方案'],
  },
]

export function shouldUseStoryPipeline(prompt: string, writeIntent: boolean) {
  return (
    writeIntent &&
    /(小说|中篇|长篇|章节|第一章|第\d+章|连载|卷纲|大纲|人物|设定|世界观|续写|历史|南明|修仙|悬疑|古言|科幻|作文|记叙文|说明文|议论文|大学写作|中学作文|素材|升格)/i.test(
      prompt,
    )
  )
}

export function buildOrUpdateStoryProject(prompt: string) {
  const store = useAppStore.getState()
  const existing = store.activeStoryProjectId
    ? store.storyProjects.find((project) => project.id === store.activeStoryProjectId)
    : undefined
  const genre = inferGenre(prompt)
  const title = inferTitle(prompt) || existing?.title || store.articleTitle || '未命名作品'

  const project = store.upsertStoryProject({
    id: existing?.id,
    chatId: store.activeChatId,
    title,
    genre: genre.name,
    targetScale: /长篇/.test(prompt) ? '长篇' : /中篇/.test(prompt) ? '中篇' : existing?.targetScale || '章节/短篇',
    premise: prompt.slice(0, 300),
    protagonist: inferProtagonist(prompt) || existing?.protagonist || '待定主角',
    coreConflict: inferConflict(prompt) || existing?.coreConflict || '目标、阻力与代价尚待展开',
  })

  const contract = store.addStoryContract({
    projectId: project.id,
    title: project.title,
    genre: project.genre,
    premise: project.premise,
    tone: genre.pacing,
    rules: genre.sceneCraft,
    taboos: genre.antiPatterns,
    readerPromise: genre.hooks[0] ?? '持续推进一个未完成的问题',
  })

  return { project, contract, genre }
}

export function createChapterBrief(prompt: string, project: StoryProject, genre: GenrePack) {
  const store = useAppStore.getState()
  const chapterNumber = nextChapterNumber(project.id)
  const strand = inferStrand(prompt, chapterNumber)
  const chapter = store.addChapterContract({
    projectId: project.id,
    chapterNumber,
    title: inferChapterTitle(prompt, chapterNumber),
    goal: inferChapterGoal(prompt),
    requiredBeats: buildRequiredBeats(prompt, genre),
    forbiddenZones: genre.risks,
    activeCharacters: [project.protagonist].filter(Boolean),
    endingHook: genre.hooks[(chapterNumber - 1) % genre.hooks.length] ?? '留下一个未闭合问题',
    strand,
  })
  const review = store.addReviewContract({
    chapterId: chapter.id,
    checks: [
      '设定一致性',
      '时间线连续',
      '角色动机',
      '因果逻辑',
      'AI 味与模板句',
      '节奏与章末钩子',
    ],
    blockingRules: [
      '违反已建立设定',
      '关键节点缺失',
      '正文为空或只有策略',
      '角色行为无动机',
    ],
  })
  const memory = composeMemoryPack(project.id)
  const briefText = [
    `作品: ${project.title}`,
    `题材: ${project.genre}`,
    `章节: 第${chapter.chapterNumber}章《${chapter.title}》`,
    `目标: ${chapter.goal}`,
    `必须覆盖: ${chapter.requiredBeats.join(' / ')}`,
    `禁区: ${chapter.forbiddenZones.join(' / ')}`,
    `题材素材: ${genre.materialBank.join(' / ')}`,
    `开篇方式: ${genre.openingPatterns.join(' / ')}`,
    `审查重点: ${genre.reviewFocus.join(' / ')}`,
    genre.structureTemplates?.length ? `结构模板: ${genre.structureTemplates.join(' / ')}` : '',
    genre.scoringRubric?.length ? `评分关注: ${genre.scoringRubric.join(' / ')}` : '',
    genre.forbiddenCliches?.length ? `避开套话: ${genre.forbiddenCliches.join(' / ')}` : '',
    `人物: ${chapter.activeCharacters.join(' / ') || '由秘书长按任务补足'}`,
    `节奏线: ${strand}`,
    `收束: ${chapter.endingHook}`,
    memory ? `长期记忆:\n${memory}` : '',
    `审查闸门: ${review.checks.join(' / ')}`,
  ]
    .filter(Boolean)
    .join('\n')

  return { project, chapter, briefText } satisfies StoryBrief
}

export function reviewDraft(draft: string, brief: StoryBrief) {
  const issues: StoryReviewIssue[] = []
  const normalized = draft.trim()

  if (normalized.length < 500) {
    issues.push(issue('critical', 'pacing', '正文长度不足或更像策略总结', '补写成完整场景与章节', true))
  }

  for (const beat of brief.chapter.requiredBeats) {
    const key = beat.replace(/[^\u4e00-\u9fa5A-Za-z0-9]/g, '').slice(0, 4)
    if (key && !normalized.includes(key)) {
      issues.push(issue('medium', 'continuity', `可能缺少节点: ${beat}`, '在二稿中补足该节点', false))
    }
  }

  const aiFlavorHits = ['他知道', '这一刻', '命运的齿轮', '无法想象', '缓缓', '微微'].filter((word) =>
    normalized.includes(word),
  )
  if (aiFlavorHits.length >= 3) {
    issues.push(
      issue(
        'medium',
        'ai_flavor',
        `模板化表达偏多: ${aiFlavorHits.join('、')}`,
        '改为动作、物件和对白潜台词',
        false,
      ),
    )
  }

  if (!/[？?。！”」]$/.test(normalized)) {
    issues.push(issue('low', 'pacing', '结尾停顿不明确', '让章末落在一个清晰钩子或动作上', false))
  }

  if (/中学|大学|记叙|说明|议论|作文|评论|科普/.test(brief.project.genre)) {
    const hasStructureCue = /(首先|其次|再次|最后|一方面|另一方面|由此可见|例如|比如|因此|然而|但是)/.test(
      normalized,
    )
    if (!hasStructureCue) {
      issues.push(
        issue(
          'medium',
          'pacing',
          '学生写作结构提示不足，可能不便于阅卷或课堂写作使用',
          '按题型补出清晰的段落推进、论证连接或说明顺序',
          false,
        ),
      )
    }

    const cliches = ['阳光总在风雨后', '世上只有妈妈好', '让我们一起', '青春不散场'].filter((word) =>
      normalized.includes(word),
    )
    if (cliches.length) {
      issues.push(
        issue(
          'medium',
          'ai_flavor',
          `出现作文套话: ${cliches.join('、')}`,
          '换成具体素材、动作和可验证论据',
          false,
        ),
      )
    }
  }

  return issues
}

export function commitChapter(draft: string, brief: StoryBrief, issues: StoryReviewIssue[]) {
  const store = useAppStore.getState()
  const blocking = issues.some((item) => item.blocking)
  const summary = summarizeDraft(draft)
  const commit = store.addChapterCommit({
    projectId: brief.project.id,
    chapterId: brief.chapter.id,
    articleId: store.activeArticleId,
    status: blocking ? 'rejected' : 'accepted',
    summary,
    wordCount: draft.length,
    dominantStrand: brief.chapter.strand,
    issues,
  })

  if (!blocking) {
    const events = extractStoryEvents(draft, brief, commit)
    store.addStoryEvents(events)
    store.upsertStoryMemories(eventsToMemories(events, brief.project.id, brief.chapter.id))
    const loops = events
      .filter((event) => event.type === 'open_loop_created')
      .map((event) => ({
        projectId: brief.project.id,
        content: event.content,
        plantedChapterId: brief.chapter.id,
        targetChapterHint: '后续 3-8 章内回收或升级',
        status: 'active' as const,
        urgency: 60,
      }))

    if (loops.length) {
      store.upsertOpenLoops(loops)
    }

    store.upsertReaderPromises([
      {
        projectId: brief.project.id,
        content: brief.chapter.endingHook,
        sourceChapterId: brief.chapter.id,
        status: 'active',
      },
    ])
  }

  return commit
}

export function formatStoryDashboard(projectId?: string) {
  const store = useAppStore.getState()
  const activeProjectId = projectId ?? store.activeStoryProjectId

  if (!activeProjectId) {
    return {
      project: undefined,
      commits: [] as ChapterCommit[],
      events: [] as StoryEvent[],
      memories: [],
      loops: [],
      promises: [],
      strandCounts: { quest: 0, fire: 0, constellation: 0 },
    }
  }

  const commits = store.chapterCommits.filter((commit) => commit.projectId === activeProjectId)
  const strandCounts = commits.reduce(
    (acc, commit) => {
      acc[commit.dominantStrand] += 1
      return acc
    },
    { quest: 0, fire: 0, constellation: 0 } satisfies Record<StoryStrand, number>,
  )

  return {
    project: store.storyProjects.find((project) => project.id === activeProjectId),
    commits,
    events: store.storyEvents.filter((event) => event.projectId === activeProjectId),
    memories: store.storyMemories.filter((memory) => memory.projectId === activeProjectId),
    loops: store.openLoops.filter((loop) => loop.projectId === activeProjectId),
    promises: store.readerPromises.filter((promise) => promise.projectId === activeProjectId),
    strandCounts,
  }
}

export function composeStoryContext() {
  const store = useAppStore.getState()
  const dashboard = formatStoryDashboard()

  if (!dashboard.project) {
    return ''
  }

  const sections = [
    `作品: ${dashboard.project.title} / ${dashboard.project.genre}`,
    `核心冲突: ${dashboard.project.coreConflict}`,
    dashboard.commits.length
      ? `近期章节:\n${dashboard.commits
          .slice(0, 5)
          .map((commit) => `- ${commit.summary}`)
          .join('\n')}`
      : '',
    dashboard.memories.length
      ? `长期记忆:\n${dashboard.memories
          .slice(0, 12)
          .map((memory) => `- [${memory.category}] ${memory.subject}.${memory.field}: ${memory.value}`)
          .join('\n')}`
      : '',
    dashboard.loops.length
      ? `开放伏笔:\n${dashboard.loops
          .slice(0, 8)
          .map((loop) => `- ${loop.content} (${loop.status})`)
          .join('\n')}`
      : '',
  ].filter(Boolean)

  const text = sections.join('\n\n')
  const budget = Math.max(1800, Math.min(5000, Math.floor(store.effectiveContextLimitTokens * 0.08)))

  return estimateTokens(text) > budget ? text.slice(0, budget * 2) : text
}

function inferGenre(prompt: string) {
  const pick = (id: string) => genrePacks.find((pack) => pack.id === id) ?? genrePacks[0]

  if (/(中学|初中|高中|中考|高考).*(记叙文|叙事|成长|亲情|友情)|记叙文.*(中学|初中|高中)/.test(prompt)) {
    return pick('middle_narrative')
  }
  if (/(中学|初中|高中|中考|高考).*(说明文|介绍|说明)|说明文.*(中学|初中|高中)/.test(prompt)) {
    return pick('middle_expository')
  }
  if (/(中学|初中|高中|中考|高考).*(议论文|论点|论据|论证)|议论文.*(中学|初中|高中)/.test(prompt)) {
    return pick('middle_argument')
  }
  if (/大学.*(记叙|散文|实践|感悟)|大学生.*(记叙|散文)/.test(prompt)) return pick('university_narrative')
  if (/大学.*(说明|科普|概念|报告)|大学生.*(说明|科普)/.test(prompt)) return pick('university_expository')
  if (/大学.*(议论|评论|公共议题|反驳)|大学生.*(议论|评论)/.test(prompt)) return pick('university_argument')
  if (/作文.*(议论|论据|论点)/.test(prompt)) return pick('middle_argument')
  if (/作文.*(说明|介绍)/.test(prompt)) return pick('middle_expository')
  if (/作文|记叙文|素材|升格/.test(prompt)) return pick('middle_narrative')
  if (/规则怪谈/.test(prompt)) return pick('rules_mystery')
  if (/无限流|副本/.test(prompt)) return pick('infinite')
  if (/末世|丧尸|避难/.test(prompt)) return pick('apocalypse')
  if (/高武|武道|体测/.test(prompt)) return pick('gaowu')
  if (/修仙|境界|宗门|灵气/.test(prompt)) return pick('xianxia')
  if (/玄幻|异世|血脉|王朝/.test(prompt)) return pick('fantasy')
  if (/历史脑洞|架空|改写历史/.test(prompt)) return pick('historical_alt')
  if (/历史|明朝|南明|朝廷|皇帝|史/.test(prompt)) return pick('history')
  if (/宫斗|宅斗|后宫/.test(prompt)) return pick('palace')
  if (/古言|王府|侯府/.test(prompt)) return pick('period')
  if (/悬疑|案件|推理/.test(prompt)) return pick('suspense')
  if (/现实题材|家庭|社会/.test(prompt)) return pick('realistic')
  if (/职场婚恋/.test(prompt)) return pick('modern_romance')
  if (/言情|狗血|替身|豪门|现言/.test(prompt)) return pick('romance')
  if (/科幻|星际|AI|飞船|未来/.test(prompt)) return pick('scifi')
  if (/都市日常|治愈|小店/.test(prompt)) return pick('urban_daily')
  if (/都市|异能|系统|直播/.test(prompt)) return pick('urban')
  return pick('history')
}

function inferTitle(prompt: string) {
  return prompt.match(/《([^》]+)》/)?.[1] ?? prompt.match(/为(.{2,16})进行/)?.[1]?.trim()
}

function inferProtagonist(prompt: string) {
  return prompt.match(/主角[是叫为：:\s]*([\u4e00-\u9fa5A-Za-z0-9]{2,12})/)?.[1]
}

function inferConflict(prompt: string) {
  if (/南明/.test(prompt)) return '南明政权在内耗、财政、军事和清军压力之间寻找生路'
  if (/中篇|长篇|小说/.test(prompt)) return '主角欲望与外部阻力持续升级'
  return prompt.slice(0, 80)
}

function inferChapterTitle(prompt: string, chapterNumber: number) {
  const explicit = prompt.match(/第[一二三四五六七八九十\d]+章[《「]?([^》」\n，。]+)/)?.[1]
  if (explicit) return explicit.trim()
  if (/南明/.test(prompt) && chapterNumber === 1) return '风雨入局'
  return `第${chapterNumber}章`
}

function inferChapterGoal(prompt: string) {
  if (/续写|补充/.test(prompt)) return '承接既有文稿，补足新的章节推进'
  if (/第一章|开篇/.test(prompt)) return '建立人物处境、核心压力和章末钩子'
  return prompt.slice(0, 160)
}

function buildRequiredBeats(prompt: string, genre: GenrePack) {
  const beats = ['开场压力具体化', '人物做出选择', '选择产生代价', `章末钩子: ${genre.hooks[0]}`]
  if (genre.essayType === 'narrative' || genre.essayType === 'prose') {
    return [
      '明确中心情感或认识变化',
      '选择一个小而具体的事件',
      '加入动作、物件、对话或环境细节',
      '结尾自然点题并照应开头',
    ]
  }
  if (genre.essayType === 'expository') {
    return [
      '明确说明对象和核心特征',
      '采用稳定的说明顺序',
      '至少使用两种说明方法或可信案例',
      '语言准确，避免抒情替代说明',
    ]
  }
  if (genre.essayType === 'argumentative' || genre.essayType === 'commentary') {
    return [
      '提出清晰中心论点',
      '设置递进或并列分论点',
      '每个论据后补足分析',
      '回应反方或现实限制后收束',
    ]
  }
  if (/南明|历史/.test(prompt)) beats.splice(1, 0, '史实锚点进入场景')
  if (/中篇|长篇/.test(prompt)) beats.splice(2, 0, '埋入后续主线债务')
  return beats
}

function inferStrand(prompt: string, chapterNumber: number): StoryStrand {
  if (/感情|关系|亲密|爱情/.test(prompt)) return 'fire'
  if (/世界观|设定|势力|规则/.test(prompt)) return 'constellation'
  return chapterNumber % 5 === 0 ? 'constellation' : chapterNumber % 3 === 0 ? 'fire' : 'quest'
}

function nextChapterNumber(projectId: string) {
  return useAppStore.getState().chapterContracts.filter((chapter) => chapter.projectId === projectId).length + 1
}

function issue(
  severity: StoryReviewIssue['severity'],
  category: StoryReviewIssue['category'],
  evidence: string,
  fixHint: string,
  blocking: boolean,
) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `issue-${Date.now()}`,
    severity,
    category,
    evidence,
    fixHint,
    blocking,
  }
}

function summarizeDraft(draft: string) {
  const first = draft.replace(/\s+/g, ' ').trim().slice(0, 180)
  return first || '本章已提交，但摘要为空。'
}

function extractStoryEvents(
  draft: string,
  brief: StoryBrief,
  commit: ChapterCommit,
): Array<Omit<StoryEvent, 'id' | 'createdAt'>> {
  const events: Array<Omit<StoryEvent, 'id' | 'createdAt'>> = [
    {
      projectId: brief.project.id,
      chapterId: brief.chapter.id,
      type: 'scene_committed',
      subject: brief.chapter.title,
      content: commit.summary,
    },
  ]

  if (brief.chapter.endingHook) {
    events.push({
      projectId: brief.project.id,
      chapterId: brief.chapter.id,
      type: 'open_loop_created',
      subject: brief.chapter.title,
      content: brief.chapter.endingHook,
    })
  }

  const location = draft.match(/在([\u4e00-\u9fa5]{2,8})(?:中|里|内|外|前|后)/)?.[1]
  if (location) {
    events.push({
      projectId: brief.project.id,
      chapterId: brief.chapter.id,
      type: 'timeline_event',
      subject: location,
      content: `本章关键场景发生在${location}`,
    })
  }

  return events
}

function eventsToMemories(
  events: Array<Omit<StoryEvent, 'id' | 'createdAt'>>,
  projectId: string,
  chapterId: string,
) {
  return events.map((event) => ({
    projectId,
    category: categoryForEvent(event.type),
    subject: event.subject,
    field: event.type,
    value: event.content,
    evidence: event.content,
    sourceChapterId: chapterId,
    status: 'active' as const,
  }))
}

function categoryForEvent(type: StoryEvent['type']): StoryMemoryCategory {
  if (type === 'open_loop_created' || type === 'open_loop_closed') return 'open_loop'
  if (type === 'reader_promise_created') return 'reader_promise'
  if (type === 'world_rule_revealed') return 'world_rule'
  if (type === 'relationship_changed') return 'relationship'
  if (type === 'timeline_event') return 'timeline'
  if (type === 'character_state_changed') return 'character_state'
  return 'story_fact'
}

function composeMemoryPack(projectId: string) {
  const store = useAppStore.getState()
  const memories = store.storyMemories
    .filter((memory) => memory.projectId === projectId && memory.status === 'active')
    .slice(0, 10)
    .map((memory) => `- ${memory.subject}: ${memory.value}`)
  const loops = store.openLoops
    .filter((loop) => loop.projectId === projectId && loop.status !== 'resolved')
    .slice(0, 6)
    .map((loop) => `- 伏笔: ${loop.content}`)

  return [...memories, ...loops].join('\n')
}
