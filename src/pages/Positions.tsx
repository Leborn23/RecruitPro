import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Upload, AlertTriangle, CheckCircle2, HelpCircle, Save, Loader2, Trash2 } from 'lucide-react';

export default function Positions() {
  const [form, setForm] = useState({
    title: '资深云原生架构师',
    department: '基础架构部',
    location: '北京/杭州',
    status: '紧急',
    threshold_score: 80,
    technical_requirements: '熟练掌握 Golang/Java, 深入理解 K8s 容器编排架构，具备千万级 QPS 系统的可用性设计经验。',
    max_age: 35,
    min_edu: '本科',
    min_exp: 5
  });
  const [positions, setPositions] = useState<any[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchPositions = async () => {
    setLoading(true);
    const { data } = await supabase.from('active_positions').select('*').order('created_at', { ascending: false });
    if (data) setPositions(data);
    setLoading(false);
  };

  useEffect(() => {
    fetchPositions();
  }, []);

  const handleDeletePosition = async (id: string) => {
    const { error } = await supabase.from('active_positions').delete().eq('id', id);
    if (!error) {
      fetchPositions();
    }
  };

  const handleSave = async () => {
    if (!form.title.trim()) {
      alert("请输入职位名称！");
      return;
    }
    
    setSaving(true);
    const { error } = await supabase.from('active_positions').insert([form]);
    setSaving(false);
    
    if (!error) {
      alert('保存成功！');
      fetchPositions();
      setForm({
        title: '',
        department: '核心开发部',
        location: '北京/杭州',
        status: '常规',
        threshold_score: 80,
        technical_requirements: '',
        max_age: 40,
        min_edu: '本科',
        min_exp: 2
      });
    } else {
      alert('保存失败：' + error.message);
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-medium text-on-surface">创建技术职位配置</h2>
          <p className="text-sm text-on-surface-variant mt-1">请填写详细的开发/算法岗位画像，大模型引擎将进行全自动的技术栈检索与源码分析推荐。</p>
        </div>
        <button 
          onClick={handleSave}
          disabled={saving}
          className="bg-primary text-white text-sm font-medium px-4 py-2 rounded-md hover:bg-primary/90 transition-colors shadow-sm flex items-center gap-2 disabled:opacity-50 cursor-pointer"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? '保存中...' : '保存配置'}
        </button>
      </div>

      <div className="grid lg:grid-cols-3 gap-8 items-start">
        
        {/* Left Col: Form fields */}
        <div className="lg:col-span-2 space-y-8">
          
          <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6">
            <h3 className="text-base font-medium text-on-surface mb-5">基础信息</h3>
            <div className="grid grid-cols-2 gap-6">
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">职位名称</label>
                <input 
                  type="text" 
                  value={form.title} 
                  onChange={(e) => setForm({...form, title: e.target.value})}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2.5 rounded-md text-sm outline-none transition-all" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">所属部门</label>
                <select 
                  value={form.department}
                  onChange={(e) => setForm({...form, department: e.target.value})}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2.5 rounded-md text-sm outline-none transition-all appearance-none cursor-pointer"
                >
                  <option>核心开发部</option>
                  <option>基础架构部</option>
                  <option>大模型实验室</option>
                  <option>云原生安全部</option>
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">工作地点</label>
                <input 
                  type="text" 
                  value={form.location} 
                  onChange={(e) => setForm({...form, location: e.target.value})}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2.5 rounded-md text-sm outline-none transition-all" 
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">招聘紧急度</label>
                <select 
                  value={form.status}
                  onChange={(e) => setForm({...form, status: e.target.value})}
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2.5 rounded-md text-sm outline-none transition-all appearance-none cursor-pointer"
                >
                  <option>紧急</option>
                  <option>常规</option>
                </select>
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-medium text-on-surface">筛选规则与技术要求</h3>
              <div className="flex items-center gap-2">
                <span className="text-xs text-on-surface-variant font-medium">智能推荐阀值:</span>
                <span className="text-sm font-bold text-primary">{form.threshold_score}分</span>
              </div>
            </div>
            
            <div className="space-y-6">
              <div className="space-y-3">
                <input 
                  type="range" 
                  min="50" 
                  max="95" 
                  step="5"
                  value={form.threshold_score}
                  onChange={(e) => setForm({...form, threshold_score: parseInt(e.target.value)})}
                  className="w-full accent-primary h-1.5 bg-surface-container rounded-lg cursor-pointer transition-all"
                />
                <div className="flex justify-between text-[10px] text-on-surface-variant font-medium px-1">
                  <span>宽容 (50)</span>
                  <span>标准 (80)</span>
                  <span>极严 (95)</span>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">针对性技术 JD 与 AI 匹配要求</label>
                <textarea 
                  rows={4}
                  value={form.technical_requirements}
                  onChange={(e) => setForm({...form, technical_requirements: e.target.value})}
                  placeholder="请输入该职位的核心技术栈、必须具备的项目经验、代码质量要求等，AI 将以此为基准进行简历比对..."
                  className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-3 rounded-md text-sm outline-none transition-all resize-none leading-relaxed" 
                />
              </div>

              <div className="pt-4 border-t border-outline-variant/15 grid grid-cols-3 gap-6">
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">最低学历要求</label>
                  <select 
                    value={form.min_edu}
                    onChange={(e) => setForm({...form, min_edu: e.target.value})}
                    className="w-full bg-surface-container-low border border-transparent focus:border-primary focus:bg-surface-container-lowest px-4 py-2.5 rounded-md text-sm outline-none transition-all appearance-none cursor-pointer"
                  >
                    <option>专科</option>
                    <option>本科</option>
                    <option>硕士</option>
                    <option>博士</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">极佳年龄上限 (<span className="text-primary font-bold">{form.max_age}</span>岁)</label>
                  <input 
                    type="range" min="20" max="60" 
                    value={form.max_age} 
                    onChange={(e) => setForm({...form, max_age: parseInt(e.target.value)})}
                    className="w-full accent-primary h-1 bg-surface-container rounded-lg cursor-pointer mt-3" 
                  />
                  <div className="flex justify-between text-[10px] text-on-surface-variant px-1">
                    <span>20岁</span>
                    <span>60岁</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant">最低工作经验 (<span className="text-primary font-bold">{form.min_exp}</span>年)</label>
                  <input 
                    type="range" min="0" max="25" 
                    value={form.min_exp} 
                    onChange={(e) => setForm({...form, min_exp: parseInt(e.target.value)})}
                    className="w-full accent-primary h-1 bg-surface-container rounded-lg cursor-pointer mt-3" 
                  />
                   <div className="flex justify-between text-[10px] text-on-surface-variant px-1">
                    <span>0年</span>
                    <span>25年</span>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6">
            <h3 className="text-base font-medium text-on-surface mb-5">参考资料</h3>
            <p className="text-sm text-on-surface-variant mb-4">您可以上传该职位的对标简历或更详细的 PDF JD，辅助 AI 进化其实验室级别的语义库。</p>
            <div className="border-2 border-dashed border-outline-variant/30 rounded-lg p-8 flex flex-col items-center justify-center bg-surface-container-low/50 hover:bg-surface-container-low transition-colors cursor-pointer group">
              <div className="w-12 h-12 bg-surface-container-lowest rounded-full shadow-sm flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
                <Upload className="w-5 h-5 text-primary" />
              </div>
              <p className="text-sm font-medium text-on-surface">点击或拖拽文件到这里</p>
              <p className="text-xs text-on-surface-variant mt-1">支持 PDF, Markdown, DOCX 格式</p>
            </div>
          </section>

        </div>

        {/* Right Col: AI Preview & Warnings */}
        <div className="space-y-6 sticky top-24">
          <section className="bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-6 shadow-[0_12px_32px_-4px_rgba(41,52,58,0.04)]">
            <h3 className="text-base font-medium text-on-surface flex items-center gap-2 mb-6">
              <CheckCircle2 className="w-4 h-4 text-primary" />
              技术画像预览
            </h3>
            
            <div className="space-y-5">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">必备技术栈序列</p>
                <div className="flex flex-wrap gap-2">
                  {['Kubernetes', 'Golang', '微服务', 'Kafka', '分布式锁', '高并发压测'].map(skill => (
                    <span key={skill} className="px-2.5 py-1 bg-surface-container text-on-surface text-xs rounded border border-outline-variant/10">{skill}</span>
                  ))}
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-4 pt-4 border-t border-outline-variant/15">
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">薪酬竞争力</p>
                  <p className="text-sm font-medium text-primary">优秀 (P75水准)</p>
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">活跃开发者供给</p>
                  <p className="text-sm font-medium text-error flex items-center gap-1">偏少 <HelpCircle className="w-3 h-3 cursor-help" /></p>
                </div>
              </div>
            </div>
          </section>

          <section className="bg-error-container/20 border border-error/20 rounded-xl p-5">
            <h3 className="text-sm font-medium text-error flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4" />
              风险提示
            </h3>
            <ul className="text-xs text-on-surface space-y-2 list-disc pl-4 marker:text-error/70">
              <li>当前“拥有千万级 QPS 架构经验”的要求限制了 90% 的候选池，导致匹配度过低。</li>
              <li>建议增加“可接受远程工作”来吸引北杭深的顶级大拿。</li>
            </ul>
          </section>
        </div>

      </div>

      <div className="pt-12 border-t border-outline-variant/15">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h2 className="text-xl font-medium text-on-surface">活动岗位配置图书馆 ({positions.length})</h2>
            <p className="text-sm text-on-surface-variant mt-1">可视化管理已入库的筛选模型，点击卡片可查看 AI 匹配深度规则。</p>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center p-12"><Loader2 className="w-8 h-8 animate-spin text-primary/30" /></div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {positions.map((pos) => (
              <div key={pos.id} className="group bg-surface-container-lowest border border-outline-variant/15 rounded-xl p-5 shadow-sm hover:shadow-md hover:border-primary/30 transition-all relative">
                <button 
                  onClick={() => handleDeletePosition(pos.id)}
                  className="absolute top-4 right-4 p-1.5 text-on-surface-variant hover:text-error hover:bg-error-container/20 rounded opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
                <div className="mb-4">
                  <h4 className="font-semibold text-lg text-on-surface mb-1">{pos.title}</h4>
                  <div className="flex items-center gap-2 text-xs text-on-surface-variant">
                    <span className="bg-surface-container px-2 py-0.5 rounded">{pos.department}</span>
                    <span className="opacity-50">·</span>
                    <span>{pos.location}</span>
                  </div>
                </div>
                
                <div className="grid grid-cols-2 gap-3 mb-5">
                  <div className="bg-surface-container-low p-2 rounded">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-tighter mb-1">AI 推荐线</p>
                    <p className="text-sm font-bold text-primary">{pos.threshold_score} 分</p>
                  </div>
                  <div className="bg-surface-container-low p-2 rounded text-right">
                    <p className="text-[10px] text-on-surface-variant uppercase font-bold tracking-tighter mb-1">学历限制</p>
                    <p className="text-sm font-bold text-on-surface">{pos.min_edu}及以上</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-5">
                   <div className="px-2 py-1 bg-surface-container-high/50 rounded text-[10px] font-medium text-on-surface-variant">
                     &lt; {pos.max_age} 岁
                   </div>
                   <div className="px-2 py-1 bg-surface-container-high/50 rounded text-[10px] font-medium text-on-surface-variant">
                     &gt; {pos.min_exp} 年经验
                   </div>
                </div>

                <div className="pt-4 border-t border-outline-variant/10">
                   <p className="text-xs text-on-surface-variant line-clamp-2 leading-relaxed italic">
                     "{pos.technical_requirements || '未设置具体技术画像规则'}"
                   </p>
                </div>
              </div>
            ))}
            {positions.length === 0 && (
              <div className="col-span-full p-20 text-center bg-surface-container-low/30 border border-dashed border-outline-variant/20 rounded-2xl flex flex-col items-center gap-3">
                 <HelpCircle className="w-8 h-8 text-outline-variant/50" />
                 <p className="text-on-surface-variant text-sm">暂无保存的岗位配置，请在上方填写表单创建。</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
