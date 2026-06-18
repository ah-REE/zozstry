import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { listen } from "@tauri-apps/api/event";
import logo from "./assets/logo.png";

export default function App() {
  const [drives, setDrives] = useState([]);
  const [scanning, setScanning] = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [isoFile, setIsoFile] = useState(null);
  const [selectedDrive, setSelectedDrive] = useState(null);
  const [isFlashing, setIsFlashing] = useState(false);
  const [flashProgress, setFlashProgress] = useState(0);
  const [flashStatus, setFlashStatus] = useState("");
  const [speed, setSpeed] = useState("");
  const [verifyData, setVerifyData] = useState(false);

  const scanDrives = async () => {
    try {
      setScanning(true);
      setErrorMsg(null);
      const result = await invoke("get_usb_drives");
      setDrives(JSON.parse(result));
    } catch (error) {
      setErrorMsg(error.toString());
    } finally {
      setScanning(false);
    }
  };

  const handleSelectIso = async () => {
    if (isFlashing) return;
    try {
      const selectedPath = await open({
        multiple: false,
        filters: [{ name: "Disk Image", extensions: ["iso"] }]
      });
      if (selectedPath) setIsoFile(selectedPath);
    } catch (error) {}
  };

  const setupListener = async () => {
    return await listen("flash-progress", (event) => {
      try {
        const data = JSON.parse(event.payload);
        if (data.error) {
           setErrorMsg(data.error);
           setIsFlashing(false);
        } else {
           setFlashProgress(data.progress);
           
           const statusParts = data.status.split(" @ ");
           setFlashStatus(statusParts[0]);
           if (statusParts.length > 1) {
             setSpeed(statusParts[1]);
           } else {
             setSpeed("");
           }

           if (data.progress === 100) setIsFlashing(false);
        }
      } catch (e) {
        console.error("Parse error", e);
      }
    });
  };

  const handleFlash = async () => {
    if (!selectedDrive || !isoFile) return;
    setIsFlashing(true);
    setFlashProgress(0);
    setFlashStatus("Initializing engine...");
    setSpeed("");
    setErrorMsg(null);

    await setupListener();
    try {
      await invoke("flash_drive", { deviceId: selectedDrive, isoPath: isoFile, verify: verifyData });
    } catch (err) {
      setErrorMsg(err.toString());
      setIsFlashing(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedDrive) return;
    setIsFlashing(true);
    setFlashProgress(0);
    setFlashStatus("Initializing restore...");
    setSpeed("");
    setErrorMsg(null);

    await setupListener();
    try {
      await invoke("restore_drive", { deviceId: selectedDrive });
    } catch (err) {
      setErrorMsg(err.toString());
      setIsFlashing(false);
    }
  };

  useEffect(() => { scanDrives(); }, []);

  const displayIsoName = isoFile ? (isoFile.split('\\').pop() || isoFile.split('/').pop()) : "";

  return (
    <main className="min-h-screen bg-[#0a0a0c] text-white p-6 flex flex-col items-center justify-center relative overflow-hidden font-sans">
      <div className="absolute top-[-20%] left-[-10%] w-[500px] h-[500px] bg-indigo-600/20 rounded-full blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-10%] w-[600px] h-[600px] bg-blue-600/10 rounded-full blur-[150px] pointer-events-none" />

      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-xl bg-white/[0.02] backdrop-blur-2xl border border-white/10 rounded-3xl shadow-2xl relative z-10 flex flex-col"
      >
        <div className="px-8 py-2 border-b border-white/5 flex items-center justify-center">
          <img 
            src={logo} 
            alt="Zozstry Logo" 
            className="h-24 object-contain drop-shadow-[0_0_15px_rgba(37,99,235,0.4)]" 
          />
        </div>

        <div className="p-8 space-y-8 flex-1">
          <section>
            <div className="flex items-center gap-2 mb-3">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-indigo-500/20 text-indigo-400 text-xs font-bold">1</span>
              <h2 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">Source Image</h2>
            </div>
            
            <button onClick={handleSelectIso} disabled={isFlashing} className={`w-full group relative overflow-hidden rounded-2xl border transition-all duration-300 flex items-center px-4 py-2 min-h-[64px] cursor-pointer disabled:cursor-not-allowed ${isoFile ? 'bg-indigo-500/10 border-indigo-500/30 shadow-[inset_0_0_20px_rgba(99,102,241,0.05)]' : 'bg-white/5 border-white/10 hover:bg-white/10 border-dashed hover:border-indigo-500/50'}`}>
              <div className="flex items-center gap-4 w-full">
                <div className={`p-2.5 rounded-xl ${isoFile ? 'bg-indigo-500/20 text-indigo-400' : 'bg-white/5 text-neutral-400 group-hover:text-indigo-400 group-hover:bg-indigo-500/10'} transition-colors`}>
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                </div>
                <div className="flex-1 text-left overflow-hidden">
                  {isoFile ? (
                    <>
                      <p className="text-sm font-medium text-white truncate">{displayIsoName}</p>
                      <p className="text-xs text-indigo-300/70 truncate mt-0.5">{isoFile}</p>
                    </>
                  ) : <p className="text-sm font-medium text-neutral-400 group-hover:text-neutral-300 transition-colors">Select an ISO file</p>}
                </div>
              </div>
            </button>
          </section>

          <section>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-500/20 text-blue-400 text-xs font-bold">2</span>
                <h2 className="text-sm font-semibold text-neutral-300 tracking-wide uppercase">Target Drive</h2>
              </div>
              
              <div className="flex items-center gap-3">
                <button 
                  onClick={handleRestore}
                  disabled={isFlashing || !selectedDrive}
                  className="text-xs font-medium bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-30 flex items-center gap-1.5 border border-red-500/20"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Restore Drive
                </button>
                <div className="w-px h-4 bg-white/10"></div>
                <button onClick={scanDrives} disabled={isFlashing} className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 flex items-center gap-1">
                  <svg className={`w-3.5 h-3.5 ${scanning ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refresh
                </button>
              </div>
            </div>

            <div className="bg-black/20 border border-white/5 rounded-2xl p-2 max-h-[160px] overflow-y-auto custom-scrollbar inset-shadow-sm">
              {scanning ? (
                <div className="flex flex-col items-center justify-center py-6 text-neutral-500">
                  <svg className="w-6 h-6 animate-spin mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  <p className="text-xs">Scanning devices...</p>
                </div>
              ) : drives.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-6 text-neutral-500">
                  <svg className="w-6 h-6 mb-2 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                  <p className="text-xs">No USB drives found</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {drives.map((drive) => (
                    <div key={drive.device_id} onClick={() => !isFlashing && setSelectedDrive(drive.device_id)} className={`w-full flex items-center justify-between p-3 rounded-xl transition-all ${isFlashing ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${selectedDrive === drive.device_id ? 'bg-blue-500/20 border-blue-500/30 border shadow-[inset_0_0_15px_rgba(59,130,246,0.15)]' : 'hover:bg-white/5 border border-transparent'}`}>
                      <div className="flex items-center gap-3">
                        <svg className={`w-5 h-5 ${selectedDrive === drive.device_id ? 'text-blue-400' : 'text-neutral-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
                        <div className="text-left">
                          <p className={`text-sm font-medium ${selectedDrive === drive.device_id ? 'text-white' : 'text-neutral-300'}`}>{drive.label}</p>
                        </div>
                      </div>
                      <span className="text-xs font-mono bg-white/10 px-2.5 py-1 rounded-md text-neutral-300">{drive.size}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

          <div className="flex items-center justify-between px-4 py-3 bg-white/5 rounded-xl border border-white/5">
             <span className="text-sm font-medium text-neutral-300 flex items-center gap-2">
               <svg className="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
               Verify Data Integrity
             </span>
             <label className="relative inline-flex items-center cursor-pointer">
               <input type="checkbox" className="sr-only peer" checked={verifyData} onChange={() => setVerifyData(!verifyData)} disabled={isFlashing} />
               <div className="w-11 h-6 bg-black/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-neutral-500 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500 peer-disabled:opacity-50"></div>
             </label>
          </div>

          <AnimatePresence>
            {errorMsg && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-start gap-3">
                  <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  <p className="text-xs font-mono whitespace-pre-wrap break-words">{errorMsg}</p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="p-8 pt-0 mt-auto">
          <div className="relative overflow-hidden rounded-2xl bg-black/40 border border-white/10 inset-shadow-sm">
            {isFlashing && (
              <motion.div 
                className="absolute left-0 top-0 bottom-0 bg-gradient-to-r from-indigo-600 via-blue-500 to-yellow-400" 
                initial={{ width: 0 }} 
                animate={{ width: `${flashProgress}%` }} 
                transition={{ ease: "linear", duration: 0.2 }} 
              >
                <div className="absolute right-0 top-0 bottom-0 w-20 bg-gradient-to-r from-transparent to-white/50 blur-md animate-pulse" />
                <span className="absolute right-2 top-1/2 -translate-y-1/2 text-2xl drop-shadow-[0_0_10px_rgba(250,204,21,1)] z-20">⚡</span>
              </motion.div>
            )}

            <div className="relative z-10 p-2 flex items-center justify-between min-h-[64px]">
              <div className="pl-4 py-2 flex-1">
                {isFlashing ? (
                  <div className="flex items-center justify-between pr-4">
                    <div className="flex flex-col">
                      <span className="text-sm font-bold text-white mb-0.5 drop-shadow-md">{flashProgress}% Complete</span>
                      <span className="text-[11px] text-white/80 font-medium truncate">{flashStatus}</span>
                    </div>
                    {speed && (
                      <div className="flex flex-col items-end">
                        <span className="text-[10px] text-white/60 font-mono tracking-widest uppercase mb-0.5">Speed</span>
                        <span className="text-sm font-mono font-bold text-white drop-shadow-md">{speed}</span>
                      </div>
                    )}
                  </div>
                ) : flashProgress === 100 && !errorMsg ? (
                  <div className="flex items-center gap-2 text-green-400 font-medium text-sm">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                    Process Complete. Safe to eject.
                  </div>
                ) : (
                  <span className="text-sm font-medium text-neutral-500">
                    {!isoFile ? 'Select an image...' : !selectedDrive ? 'Select target drive...' : 'Ready to ignite'}
                  </span>
                )}
              </div>

              {!isFlashing && (
                <button 
                  onClick={handleFlash}
                  disabled={!selectedDrive || !isoFile}
                  className={`py-3 px-8 rounded-xl font-bold text-sm tracking-wide transition-all duration-300 ${!selectedDrive || !isoFile ? 'bg-white/5 text-neutral-500 cursor-not-allowed' : 'bg-gradient-to-r from-white to-neutral-200 text-black hover:scale-[1.02] active:scale-[0.98] shadow-[0_0_20px_rgba(255,255,255,0.15)] cursor-pointer'}`}
                >
                  Flash Drive
                </button>
              )}
            </div>
          </div>
        </div>
      </motion.div>
      
      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
      `}} />
    </main>
  );
}