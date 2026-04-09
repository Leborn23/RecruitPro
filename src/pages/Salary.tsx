import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { 
  TrendingUp, 
  AlertCircle, 
  ArrowRight,
  Database,
  Wallet,
  Loader2
} from 'lucide-react';

export default function Salary() {
  const [activeTab, setActiveTab] = useState<'market' | 'internal'>('market');
  const [salaries, setSalaries] = useState<any[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);

  const fetchSalaries = async () => {
    const { data } = await supabase.from('market_salaries').select('*').order('average_salary', { ascending: false });
    if (data) setSalaries(data);
  };

  useEffect(() => {
    fetchSalaries();
  }, []);

  const handleSync = async () => {
    setIsSyncing(true);
    // Simulate python scraper execution delay
    await new Promise(resolve => setTimeout(resolve, 2000));
    await fetchSalaries();
    setIsSyncing(false);
    alert('爬虫同步完成：已根据 jobui.com 最新挂牌行情更新 3 条核心岗位薪资。');
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500 pb-10">
      
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-on-surface">薪酬竞争力监控</h2>
          <p className="text-sm text-on-surface-variant mt-1">实时追踪外部招聘市场薪水大盘与内部研发序列倒挂风险。</p>
        </div>
        <div className="bg-surface-container-low p-1 rounded-lg inline-flex">
          <button 
            onClick={() => setActiveTab('market')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
              activeTab === 'market' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant/70 hover:text-on-surface-variant'
            }`}
          >
            全网市场对标
          </button>
          <button 
            onClick={() => setActiveTab('internal')}
            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all cursor-pointer ${
              activeTab === 'internal' ? 'bg-surface-container-lowest text-on-surface shadow-sm' : 'text-on-surface-variant/70 hover:text-on-surface-variant'
            }`}
          >
            内部薪酬审计
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            <h3 className="text-sm font-medium text-on-surface">整体市场动向 (北京)</h3>
          </div>
          <p className="text-2xl font-semibold text-primary my-3">↑ 12.4%</p>
          <p className="text-xs text-on-surface-variant">大模型/AI算法方向薪资溢价激增，较上季度上涨明显。</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <AlertCircle className="w-5 h-5 text-error" />
            <h3 className="text-sm font-medium text-on-surface">内部倒挂预警</h3>
          </div>
          <p className="text-2xl font-semibold text-on-surface my-3">2 <span className="text-base text-on-surface-variant">条核心业务线</span></p>
          <p className="text-xs text-on-surface-variant">前端基建组和微服务中台新入职员工薪资超越老员工 P70 分位。</p>
        </div>
        <div className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-3 mb-2">
            <Wallet className="w-5 h-5 text-on-surface-variant" />
            <h3 className="text-sm font-medium text-on-surface">平均猎头溢价率</h3>
          </div>
          <p className="text-2xl font-semibold text-on-surface my-3">18% - 25%</p>
          <p className="text-xs text-on-surface-variant">对于紧缺的 "云原生架构师" 岗位，猎头费率普遍上浮。</p>
        </div>
      </div>

      <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-8 pb-4 border-b border-outline-variant/10">
          <h3 className="text-base font-medium text-on-surface flex gap-2 items-center">
            <Database className="w-4 h-4 text-primary" /> 
            最新爬取实时市场薪资 (月薪)
          </h3>
          <button 
            onClick={handleSync} 
            disabled={isSyncing}
            className={`text-xs font-medium flex items-center gap-1 hover:underline cursor-pointer transition-opacity ${isSyncing ? 'opacity-50 cursor-wait' : 'text-primary'}`}
          >
            {isSyncing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Database className="w-3 h-3" />}
            {isSyncing ? '正在抓取职友集行情...' : '手动触发网络爬虫'} <ArrowRight className="w-3 h-3" />
          </button>
        </div>
        
        <div className="space-y-8">
          {salaries.length === 0 ? (
             <div className="text-sm text-on-surface-variant p-4">Loading Live Data from Supabase...</div>
          ) : salaries.map((job: any) => {
             const range = 60000;
             const rawMin = job.min_salary;
             const rawMax = job.max_salary;
             const rawAvg = job.average_salary;
             
             const minPercent = Math.max(0, Math.min(100, (rawMin / range) * 100));
             const widthPercent = Math.max(10, Math.min(100, ((rawMax - rawMin) / range) * 100));
             const dotPercent = Math.max(0, Math.min(100, ((rawAvg - rawMin) / (rawMax - rawMin)) * 100));

             return (
              <div key={job.id} className="grid md:grid-cols-[1fr_2fr_120px] gap-6 items-center group">
                <div>
                  <h4 className="text-sm font-bold text-on-surface mb-1 group-hover:text-primary transition-colors">{job.role}</h4>
                  <p className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase">{job.city} · 实时数据</p>
                </div>
                
                <div className="w-full relative h-12 flex items-center">
                   <div className="absolute w-full h-1.5 bg-surface-container rounded-full"></div>
                   
                   <div 
                     style={{ left: `${minPercent}%`, width: `${widthPercent}%` }} 
                     className="absolute h-3 bg-primary/20 rounded-full border border-primary/30"
                   >
                      <div 
                        style={{ left: `${dotPercent}%` }} 
                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 bg-primary rounded-full shadow-[0_0_0_4px_rgba(0,107,255,0.15)] z-10"
                      ></div>
                   </div>

                   <div className="absolute top-8 left-0 text-[10px] text-on-surface-variant font-medium">¥0</div>
                   <div className="absolute top-8 right-0 text-[10px] text-on-surface-variant font-medium">¥60k+</div>
                </div>

                <div className="text-right">
                   <p className="text-lg font-bold text-on-surface">¥ {rawAvg.toLocaleString()}</p>
                   <p className="text-[10px] text-on-surface-variant pt-1">{rawMin.toLocaleString()} - {rawMax.toLocaleString()}</p>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      
      <section className="bg-primary-container/10 border border-primary/10 rounded-xl p-6 mt-8 flex flex-col md:flex-row gap-6 justify-between items-center">
         <div>
            <h3 className="font-semibold text-on-surface mb-2">生成薪酬调整方案</h3>
            <p className="text-sm text-on-surface-variant">结合您的员工绩效数据与最新爬取的市场薪资库，一键生成年度调薪（Merit Cycle）预测模型。</p>
         </div>
         <button onClick={() => alert('调薪方案建模服务初始化中...')} className="px-5 py-2.5 bg-primary text-white text-sm font-medium rounded-md hover:bg-primary/90 transition-colors shadow-sm cursor-pointer shrink-0">
           启动建模分析
         </button>
      </section>
    </div>
  );
}
