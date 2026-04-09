export const NAV_LINKS = [
  { id: 'dashboard', icon: 'LayoutDashboard', label: '招聘决策台', path: '/' },
  { id: 'positions', icon: 'Briefcase', label: '职位配置', path: '/positions' },
  { id: 'screening', icon: 'ListChecks', label: '简历筛选', path: '/screening' },
  { id: 'candidates', icon: 'Users', label: '候选人库', path: '/candidates' },
  { id: 'interviews', icon: 'Calendar', label: '面试安排', path: '/interviews' },
  { id: 'salary', icon: 'CircleDollarSign', label: '薪资参考', path: '/salary' },
  { id: 'settings', icon: 'Settings', label: '设置', path: '/settings' },
];

export const ACTIVE_POSITIONS = [
  { id: 1, title: '高级临床监查员 (Sr. CRA)', department: '临床运营部', location: '北京/上海', status: '紧急' },
  { id: 2, title: '医学撰写经理 (Medical Writing)', department: '医学事务部', location: '远程', status: '常规' },
];

export const CANDIDATES_FOR_REVIEW = [
  { id: 1, name: '张晓文', degree: '硕士', experience: '5年经验', previousCompany: '某知名CRO' },
  { id: 2, name: '李明华', degree: '本科', experience: '8年经验', previousCompany: '头部药企' },
];

export const UPCOMING_INTERVIEWS = [
  { id: 1, name: '王志强', stage: '二轮技术面', position: 'Java后端架构师' },
  { id: 2, name: '周美玲', stage: '初试', position: '临床运营经理' },
  { id: 3, name: 'Alex Thompson', stage: 'Final Review', position: 'Clinical Director' },
];
