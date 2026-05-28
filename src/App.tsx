import React, { useEffect, useMemo, useState } from "react";
import {
  Armchair,
  Camera,
  Check,
  ChevronRight,
  Download,
  Expand,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

type Mode = "room" | "style";
type Resolution = "1K" | "2K" | "4K";
type AspectRatio = "1:1" | "3:4" | "4:3" | "16:9";
type ViewMode = "wide" | "mid" | "close" | "model";
type StyleId = "minimal" | "luxury";

interface SceneAnalysis {
  roomType: string;
  style: string;
  lighting: string;
  lightingDirection?: string;
  colorPalette: string;
  cameraAngle: string;
  perspectiveCues?: string;
  placementSuggestion: string;
  recommendedScale?: string;
  recommendedOrientation?: string;
  modelInteractionSuggestion?: string;
  elements: string[];
}

interface HistoryItem {
  id: string;
  imageUrl: string;
  mode: Mode;
  styleId?: StyleId;
  viewMode: ViewMode;
  ratio: AspectRatio;
  resolution: Resolution;
  createdAt: string;
}

interface UploadBoxProps {
  title: string;
  hint: string;
  image?: string;
  onUpload: (base64: string) => void;
  tall?: boolean;
}

const RESOLUTIONS: Resolution[] = ["1K", "2K", "4K"];
const RATIOS: AspectRatio[] = ["1:1", "3:4", "4:3", "16:9"];

const VIEW_OPTIONS: Array<{
  id: ViewMode;
  label: string;
  description: string;
  icon: React.ElementType;
}> = [
  { id: "wide", label: "远景", description: "全屋清晰主角", icon: Expand },
  { id: "mid", label: "中近景", description: "局部空间中景", icon: LayoutGrid },
  { id: "close", label: "近景", description: "局部细节特写", icon: Camera },
  { id: "model", label: "模特", description: "生活方式带人", icon: User },
];

const STYLE_OPTIONS: Array<{
  id: StyleId;
  label: string;
  title: string;
  description: string;
}> = [
  {
    id: "minimal",
    label: "简洁风格",
    title: "高端简洁",
    description: "展开状态乐至宝单椅，自然光、留白、质感地毯，高级电商画册感。",
  },
  {
    id: "luxury",
    label: "奢华风格",
    title: "高级奢华",
    description: "展开状态乐至宝单椅，石材、金属、层次灯光，高客单家具大片感。",
  },
];

const defaultAnalysis: SceneAnalysis = {
  roomType: "",
  style: "",
  lighting: "",
  colorPalette: "",
  cameraAngle: "",
  placementSuggestion: "",
  elements: [],
};

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function UploadBox({ title, hint, image, onUpload, tall = false }: UploadBoxProps) {
  const [dragging, setDragging] = useState(false);

  const handleFiles = async (files?: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    onUpload(await readFileAsDataUrl(file));
  };

  return (
    <label
      onDragEnter={(event) => {
        event.preventDefault();
        setDragging(true);
      }}
      onDragOver={(event) => event.preventDefault()}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragging(false);
        handleFiles(event.dataTransfer.files);
      }}
      className={`group relative flex w-full cursor-pointer flex-col items-center justify-center overflow-hidden border-2 border-dashed bg-white transition-all ${
        tall ? "min-h-[280px]" : "min-h-[220px]"
      } rounded-[8px] ${
        dragging
          ? "border-[#1f2428] shadow-[0_18px_60px_rgba(31,36,40,0.12)]"
          : "border-[#ddd9d0] hover:border-[#1f2428]"
      }`}
    >
      {image ? (
        <>
          <img src={image} alt={title} className="h-full min-h-[inherit] w-full object-contain bg-[#f7f5ef] p-4" />
          <div className="absolute inset-0 flex items-center justify-center bg-black/45 opacity-0 transition-opacity group-hover:opacity-100">
            <div className="flex items-center gap-2 rounded-[8px] bg-white px-4 py-2 text-sm font-semibold text-[#1f2428] shadow-lg">
              <RefreshCw className="h-4 w-4" />
              重新上传
            </div>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 px-6 text-center text-[#8b8780]">
          <div className="flex h-12 w-12 items-center justify-center rounded-[8px] border border-[#ddd9d0] bg-[#faf9f6]">
            <ImageIcon className="h-6 w-6" />
          </div>
          <div>
            <p className="text-sm font-semibold text-[#4a4f52]">{title}</p>
            <p className="mt-1 text-xs">{hint}</p>
          </div>
        </div>
      )}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </label>
  );
}

type PillButtonProps = {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
};

function PillButton({ active, children, onClick, disabled }: PillButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`h-9 rounded-[8px] px-3 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-45 ${
        active ? "bg-[#171819] text-white shadow-sm" : "bg-[#e7e5df] text-[#555b5d] hover:bg-[#dcd9d1]"
      }`}
    >
      {children}
    </button>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>("room");
  const [productImage, setProductImage] = useState("");
  const [sceneImage, setSceneImage] = useState("");
  const [analysis, setAnalysis] = useState<SceneAnalysis>(defaultAnalysis);
  const [selectedElements, setSelectedElements] = useState<string[]>([]);
  const [addedElements, setAddedElements] = useState<string[]>([]);
  const [manualElement, setManualElement] = useState("");
  const [styleId, setStyleId] = useState<StyleId>("minimal");
  const [viewMode, setViewMode] = useState<ViewMode>("wide");
  const [resolution, setResolution] = useState<Resolution>("1K");
  const [ratio, setRatio] = useState<AspectRatio>("1:1");
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState("");
  const [saasConfig, setSaasConfig] = useState<{ userId?: string; toolId?: string }>({});
  const [userData, setUserData] = useState<{ name?: string; integral?: number } | null>(null);
  const [toolData, setToolData] = useState<{ integral?: number } | null>(null);

  const currentResult = history[0]?.imageUrl;
  const activeStyle = STYLE_OPTIONS.find((style) => style.id === styleId) || STYLE_OPTIONS[0];

  const canGenerate = useMemo(() => {
    if (!productImage || isGenerating) return false;
    if (mode === "room") return Boolean(sceneImage);
    return true;
  }, [isGenerating, mode, productImage, sceneImage]);

  useEffect(() => {
    const launch = async (userId: string, toolId: string) => {
      try {
        const res = await fetch("/api/tool/launch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId, toolId }),
        });
        const data = await res.json();
        if (data.success) {
          setUserData(data.data?.user || null);
          setToolData(data.data?.tool || null);
        }
      } catch (launchError) {
        console.error("SaaS launch failed:", launchError);
      }
    };

    const params = new URLSearchParams(window.location.search);
    const userId = params.get("userId") || undefined;
    const toolId = params.get("toolId") || undefined;
    if (userId && toolId) {
      setSaasConfig({ userId, toolId });
      launch(userId, toolId);
    }

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SAAS_INIT" && event.data.userId && event.data.toolId) {
        setSaasConfig({ userId: event.data.userId, toolId: event.data.toolId });
        launch(event.data.userId, event.data.toolId);
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const resetAnalysis = () => {
    setAnalysis(defaultAnalysis);
    setSelectedElements([]);
    setAddedElements([]);
  };

  const handleViewModeChange = (nextViewMode: ViewMode) => {
    setViewMode(nextViewMode);
    if (mode === "room" && nextViewMode !== viewMode) {
      resetAnalysis();
    }
  };

  const handleAnalyze = async () => {
    if (!sceneImage) return;
    setIsAnalyzing(true);
    setError("");
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sceneImage, viewMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "场景分析失败");
      setAnalysis(data);
      setSelectedElements(data.elements || []);
      setAddedElements([]);
    } catch (analyzeError: any) {
      setError(analyzeError.message || "场景分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    setIsGenerating(true);
    setError("");
    try {
      const recognizedElements = analysis.elements || [];
      const removedElements = recognizedElements.filter((element) => !selectedElements.includes(element));
      const res = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          productImage,
          sceneImage: mode === "room" ? sceneImage : undefined,
          styleId,
          viewMode,
          ratio,
          resolution,
          sceneAnalysis: analysis,
          selectedElements,
          removedElements,
          addedElements,
          userId: saasConfig.userId,
          toolId: saasConfig.toolId,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "图像生成失败");
      if (!data.imageUrl) throw new Error(data.text || "Gemini 未返回图像");

      const item: HistoryItem = {
        id: `${Date.now()}`,
        imageUrl: data.imageUrl,
        mode,
        styleId: mode === "style" ? styleId : undefined,
        viewMode,
        ratio,
        resolution,
        createdAt: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }),
      };
      setHistory((items) => [item, ...items].slice(0, 24));
      setPreviewImage(data.imageUrl);
    } catch (generateError: any) {
      setError(generateError.message || "图像生成失败");
    } finally {
      setIsGenerating(false);
    }
  };

  const toggleElement = (element: string) => {
    setSelectedElements((items) =>
      items.includes(element) ? items.filter((item) => item !== element) : [...items, element],
    );
  };

  const addManualElement = () => {
    const value = manualElement.trim();
    if (!value) return;
    setAddedElements((items) => Array.from(new Set([...items, value])));
    setManualElement("");
  };

  const removeAddedElement = (element: string) => {
    setAddedElements((items) => items.filter((item) => item !== element));
  };

  const removeHistory = (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setHistory((items) => items.filter((item) => item.id !== id));
  };

  const downloadImage = (url: string) => {
    const link = document.createElement("a");
    link.href = url;
    link.download = `sofa-ecommerce-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="flex min-h-screen bg-[#f7f5ef] text-[#1e2428]">
      <aside className="hidden w-[320px] shrink-0 flex-col border-r border-[#e6e1d8] bg-[#fbfaf7] px-6 py-7 lg:flex">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-[8px] bg-[#171819] text-white">
            <Armchair className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-extrabold tracking-tight">SofaGen AI</h1>
            <p className="text-xs font-medium text-[#8b8780]">单人沙发电商图</p>
          </div>
        </div>

        <nav className="mt-10 space-y-2">
          <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-[#9c968c]">导航菜单</p>
          <button
            type="button"
            onClick={() => setMode("room")}
            className={`flex w-full items-center gap-3 rounded-[8px] px-4 py-3 text-left text-sm font-semibold transition-all ${
              mode === "room"
                ? "bg-white text-[#171819] shadow-sm ring-1 ring-[#e2ddd4]"
                : "text-[#77736b] hover:bg-white"
            }`}
          >
            <Camera className="h-5 w-5" />
            构图分析与沙发替换
          </button>
          <button
            type="button"
            onClick={() => setMode("style")}
            className={`flex w-full items-center gap-3 rounded-[8px] px-4 py-3 text-left text-sm font-semibold transition-all ${
              mode === "style"
                ? "bg-white text-[#171819] shadow-sm ring-1 ring-[#e2ddd4]"
                : "text-[#77736b] hover:bg-white"
            }`}
          >
            <LayoutGrid className="h-5 w-5" />
            风格直接融合生成
          </button>
        </nav>

        <div className="mt-auto border-t border-[#e6e1d8] pt-6">
          <div className="flex items-center gap-3 rounded-[8px] bg-[#efede7] p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-[8px] bg-white font-bold text-[#77736b]">
              {userData?.name?.[0] || "本"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold">{userData?.name || "本地调试"}</p>
              <p className="text-xs text-[#8b8780]">
                {userData ? `${userData.integral ?? 0} 积分可用` : "仅本机调用 Gemini"}
              </p>
            </div>
          </div>
          <p className="mt-3 text-center text-xs text-[#aaa49a]">
            {toolData ? `每次生成消耗 ${toolData.integral ?? 10} 积分` : "调试完成后再接入上线扣点流程"}
          </p>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center justify-between border-b border-[#e6e1d8] bg-white px-5 lg:px-8">
          <div>
            <p className="text-sm font-bold text-[#4a4f52]">沙发产品图</p>
            <p className="hidden text-xs text-[#9c968c] sm:block">上传产品图，一键生成可投放的家居电商场景图</p>
          </div>
          <div className="flex items-center gap-2 rounded-[8px] bg-[#f2f0ea] px-3 py-2 text-xs font-semibold text-[#77736b]">
            <Sparkles className="h-4 w-4" />
            Gemini 生图
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-8 lg:px-10">
          <div className="mx-auto grid max-w-[1280px] grid-cols-1 gap-8 xl:grid-cols-[1fr_420px]">
            <section className="space-y-7">
              <div className="flex flex-wrap gap-2 lg:hidden">
                <PillButton active={mode === "room"} onClick={() => setMode("room")}>
                  场景融入
                </PillButton>
                <PillButton active={mode === "style"} onClick={() => setMode("style")}>
                  风格生成
                </PillButton>
              </div>

              <AnimatePresence mode="wait">
                {mode === "room" ? (
                  <motion.div
                    key="room-mode"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="space-y-6"
                  >
                    <div className="grid gap-6 xl:grid-cols-2">
                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-bold">步骤 1：上传房间场景图</p>
                          {analysis.elements.length > 0 && (
                            <span className="text-xs font-semibold text-[#6f6a60]">已识别 {analysis.elements.length} 项</span>
                          )}
                        </div>
                        <UploadBox
                          title="点击或拖拽上传场景图"
                          hint="客厅、卧室、休闲区等空间图"
                          image={sceneImage}
                          onUpload={(image) => {
                            setSceneImage(image);
                            resetAnalysis();
                          }}
                          tall
                        />
                        <button
                          type="button"
                          onClick={handleAnalyze}
                          disabled={!sceneImage || isAnalyzing}
                          className="flex h-12 w-full items-center justify-center gap-2 rounded-[8px] bg-[#8d8a84] text-base font-extrabold text-white shadow-sm transition-all hover:bg-[#171819] disabled:cursor-not-allowed disabled:opacity-45"
                        >
                          {isAnalyzing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
                          {isAnalyzing ? "正在分析场景" : "开始分析按钮"}
                        </button>
                      </div>

                      <div className="space-y-3">
                        <p className="text-sm font-bold">步骤 2：上传单人沙发产品图</p>
                        <UploadBox
                          title="点击或拖拽上传沙发"
                          hint="建议白底或干净背景，保留完整轮廓"
                          image={productImage}
                          onUpload={setProductImage}
                          tall
                        />
                      </div>
                    </div>

                    <section className="rounded-[8px] border border-[#ebe7df] bg-white p-5">
                      <div className="mb-4 flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-extrabold">已识别出的画面元素</p>
                          <p className="mt-1 text-xs text-[#8b8780]">选中=必须保留，取消=必须删除；手动添加=必须新增</p>
                        </div>
                        {analysis.placementSuggestion && (
                          <span className="hidden max-w-[360px] text-right text-xs font-medium text-[#77736b] md:block">
                            {analysis.placementSuggestion}
                          </span>
                        )}
                      </div>

                      {analysis.elements.length > 0 && (
                        <div className="mb-4 grid gap-2 text-xs text-[#5f6466] md:grid-cols-2">
                          {[
                            ["光线", analysis.lightingDirection || analysis.lighting],
                            ["透视", analysis.perspectiveCues || analysis.cameraAngle],
                            ["大小", analysis.recommendedScale],
                            ["朝向", analysis.recommendedOrientation],
                            ["模特", analysis.modelInteractionSuggestion],
                          ]
                            .filter(([, value]) => Boolean(value))
                            .map(([label, value]) => (
                              <div key={label} className="rounded-[8px] bg-[#f2f0ea] px-3 py-2">
                                <span className="font-extrabold text-[#1e2428]">{label}：</span>
                                {value}
                              </div>
                            ))}
                        </div>
                      )}

                      <div className="flex flex-wrap gap-2">
                        {analysis.elements.length === 0 ? (
                          <div className="flex min-h-20 w-full items-center justify-center rounded-[8px] border border-dashed border-[#ddd9d0] text-sm text-[#aaa49a]">
                            暂无识别结果，请先上传场景并点击分析
                          </div>
                        ) : (
                          analysis.elements.map((element) => (
                            <button
                              key={element}
                              type="button"
                              onClick={() => toggleElement(element)}
                              className={`rounded-[8px] px-3 py-2 text-sm font-semibold transition-all ${
                                selectedElements.includes(element)
                                  ? "bg-[#171819] text-white"
                                  : "bg-red-50 text-red-700 hover:bg-red-50"
                              }`}
                            >
                              {selectedElements.includes(element) && <Check className="mr-1 inline h-4 w-4" />}
                              {!selectedElements.includes(element) && <X className="mr-1 inline h-4 w-4" />}
                              {element}
                            </button>
                          ))
                        )}
                        {addedElements.map((element) => (
                          <button
                            key={`added-${element}`}
                            type="button"
                            onClick={() => removeAddedElement(element)}
                            className="rounded-[8px] bg-[#171819] px-3 py-2 text-sm font-semibold text-white transition-all hover:bg-black"
                            title="点击移除新增物品"
                          >
                            <Plus className="mr-1 inline h-4 w-4" />
                            新增 {element}
                          </button>
                        ))}
                        <div className="flex h-10 items-center gap-2 rounded-[8px] border border-[#ddd9d0] bg-white px-3">
                          <input
                            value={manualElement}
                            onChange={(event) => setManualElement(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === "Enter") addManualElement();
                            }}
                            placeholder="手动添加标签..."
                            className="w-36 border-0 bg-transparent text-sm outline-none placeholder:text-[#aaa49a]"
                          />
                          <button type="button" onClick={addManualElement} className="text-[#77736b] hover:text-[#171819]">
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </section>
                  </motion.div>
                ) : (
                  <motion.div
                    key="style-mode"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="grid gap-8 xl:grid-cols-[1fr_360px]"
                  >
                    <div className="space-y-3">
                      <p className="text-sm font-bold">上传您的单人沙发产品图</p>
                      <UploadBox
                        title="点击或拖拽上传沙发"
                        hint="AI 会保持沙发外观并生成新场景"
                        image={productImage}
                        onUpload={setProductImage}
                        tall
                      />
                    </div>

                    <section className="rounded-[8px] border border-[#ebe7df] bg-white p-5">
                      <p className="text-sm font-extrabold">选择预设视觉风格</p>
                      <div className="mt-4 space-y-3">
                        {STYLE_OPTIONS.map((style) => (
                          <button
                            key={style.id}
                            type="button"
                            onClick={() => setStyleId(style.id)}
                            className={`w-full rounded-[8px] p-4 text-left transition-all ${
                              styleId === style.id
                                ? "bg-[#171819] text-white shadow-lg"
                                : "bg-[#f2f0ea] text-[#4a4f52] hover:bg-[#e7e5df]"
                            }`}
                          >
                            <span className="flex items-center justify-between gap-3">
                              <span className="text-base font-extrabold">{style.label}</span>
                              <ChevronRight className="h-5 w-5" />
                            </span>
                            <span className={`mt-2 block text-xs ${styleId === style.id ? "text-white/72" : "text-[#77736b]"}`}>
                              {style.description}
                            </span>
                          </button>
                        ))}
                      </div>
                    </section>
                  </motion.div>
                )}
              </AnimatePresence>

              <section className="space-y-5 border-t border-[#e1ddd4] pt-7">
                <div className="flex items-center gap-2">
                  <History className="h-6 w-6" />
                  <h2 className="text-xl font-extrabold">生成历史</h2>
                </div>
                <div className="min-h-[260px] rounded-[8px] border-2 border-dashed border-[#ddd9d0] bg-white p-4">
                  {history.length === 0 ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-[#aaa49a]">暂无历史记录</div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                      {history.map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => setPreviewImage(item.imageUrl)}
                          className="group relative overflow-hidden rounded-[8px] bg-[#efede7] text-left shadow-sm"
                        >
                          <img src={item.imageUrl} alt="生成历史" className="aspect-square w-full object-cover" />
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-3 text-white">
                            <p className="text-xs font-bold">
                              {VIEW_OPTIONS.find((view) => view.id === item.viewMode)?.label} · {item.resolution} · {item.ratio}
                            </p>
                            <p className="text-[11px] text-white/72">{item.createdAt}</p>
                          </div>
                          <button
                            type="button"
                            onClick={(event) => removeHistory(item.id, event)}
                            className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/90 text-[#1e2428] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                            aria-label="删除历史"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </section>
            </section>

            <aside className="space-y-5 xl:sticky xl:top-8 xl:self-start">
              <section className="rounded-[8px] border border-[#ebe7df] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Camera className="h-5 w-5" />
                  <p className="text-sm font-extrabold">视角选择</p>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {VIEW_OPTIONS.map((view) => {
                    const Icon = view.icon;
                    return (
                      <button
                        key={view.id}
                        type="button"
                        onClick={() => handleViewModeChange(view.id)}
                        className={`rounded-[8px] p-3 text-left transition-all ${
                          viewMode === view.id
                            ? "bg-[#171819] text-white shadow-md"
                            : "bg-[#f2f0ea] text-[#4a4f52] hover:bg-[#e7e5df]"
                        }`}
                      >
                        <Icon className="h-5 w-5" />
                        <span className="mt-2 block text-sm font-extrabold">{view.label}</span>
                        <span className={`mt-1 block text-[11px] ${viewMode === view.id ? "text-white/70" : "text-[#77736b]"}`}>
                          {view.description}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="rounded-[8px] border border-[#ebe7df] bg-white p-5 shadow-sm">
                <div className="flex items-center gap-2">
                  <Settings className="h-5 w-5" />
                  <p className="text-sm font-extrabold">配置中心 / 用户设置参数</p>
                </div>

                <div className="mt-5 space-y-5">
                  <div>
                    <p className="mb-3 text-xs font-bold text-[#4a4f52]">画面分辨率</p>
                    <div className="grid grid-cols-3 gap-2">
                      {RESOLUTIONS.map((item) => (
                        <React.Fragment key={item}>
                          <PillButton active={resolution === item} onClick={() => setResolution(item)}>
                            {item}
                          </PillButton>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-3 text-xs font-bold text-[#4a4f52]">画面比例</p>
                    <div className="grid grid-cols-2 gap-2">
                      {RATIOS.map((item) => (
                        <React.Fragment key={item}>
                          <PillButton active={ratio === item} onClick={() => setRatio(item)}>
                            {item}
                          </PillButton>
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              </section>

              <button
                type="button"
                onClick={handleGenerate}
                disabled={!canGenerate}
                className="flex h-[70px] w-full items-center justify-center gap-3 rounded-[8px] bg-[#171819] text-lg font-extrabold text-white shadow-[0_18px_42px_rgba(31,36,40,0.24)] transition-all hover:translate-y-[-1px] hover:bg-black disabled:translate-y-0 disabled:bg-[#96928b] disabled:shadow-none"
              >
                {isGenerating ? <Loader2 className="h-6 w-6 animate-spin" /> : <Sparkles className="h-6 w-6" />}
                {isGenerating ? "正在生成图像" : "生成图像按钮"}
              </button>

              {error && (
                <div className="rounded-[8px] border border-red-200 bg-red-50 p-4 text-sm font-medium text-red-700">{error}</div>
              )}

              <section className="rounded-[8px] border border-[#ebe7df] bg-white p-5 shadow-sm">
                <p className="text-sm font-extrabold">当前任务</p>
                <div className="mt-3 space-y-2 text-xs leading-5 text-[#6f6a60]">
                  <p>模式：{mode === "room" ? "上传房间场景融入沙发" : `选择风格直接生成 · ${activeStyle.title}`}</p>
                  <p>视角：{VIEW_OPTIONS.find((view) => view.id === viewMode)?.label}</p>
                  <p>输出：{resolution} / {ratio}</p>
                </div>
              </section>

              {currentResult && (
                <section className="rounded-[8px] border border-[#ebe7df] bg-white p-3 shadow-sm">
                  <button type="button" onClick={() => setPreviewImage(currentResult)} className="block w-full overflow-hidden rounded-[8px]">
                    <img src={currentResult} alt="最新结果" className="aspect-square w-full object-cover" />
                  </button>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => setPreviewImage(currentResult)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-[8px] bg-[#efede7] px-3 py-2 text-sm font-bold text-[#4a4f52]"
                    >
                      <Expand className="h-4 w-4" />
                      预览
                    </button>
                    <button
                      type="button"
                      onClick={() => downloadImage(currentResult)}
                      className="flex flex-1 items-center justify-center gap-2 rounded-[8px] bg-[#171819] px-3 py-2 text-sm font-bold text-white"
                    >
                      <Download className="h-4 w-4" />
                      下载
                    </button>
                  </div>
                </section>
              )}
            </aside>
          </div>
        </div>
      </main>

      <AnimatePresence>
        {previewImage && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-5 backdrop-blur"
          >
            <button
              type="button"
              onClick={() => setPreviewImage(null)}
              className="absolute right-5 top-5 flex h-11 w-11 items-center justify-center rounded-[8px] bg-white/10 text-white hover:bg-white/20"
              aria-label="关闭预览"
            >
              <X className="h-6 w-6" />
            </button>
            <div className="flex max-h-full max-w-5xl flex-col items-center gap-4">
              <img src={previewImage} alt="生成结果预览" className="max-h-[82vh] max-w-full rounded-[8px] object-contain shadow-2xl" />
              <button
                type="button"
                onClick={() => downloadImage(previewImage)}
                className="flex items-center gap-2 rounded-[8px] bg-white px-6 py-3 text-sm font-extrabold text-[#171819]"
              >
                <Download className="h-5 w-5" />
                下载生成图
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
