import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { invoke } from "@tauri-apps/api/core";
import { open, ask } from "@tauri-apps/plugin-dialog";
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
  
  // Modal States
  const [showInfo, setShowInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  
  // Active App States & Settings
  const [verifyData, setVerifyData] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [skipWarnings, setSkipWarnings] = useState(false);
  const [forceGpt, setForceGpt] = useState(false);
  const [autoVerify, setAutoVerify] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState(0);

  // Sync Auto-Verify with the main screen toggle
  useEffect(() => {
    if (autoVerify) setVerifyData(true);
  }, [autoVerify]);

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

    if (!skipWarnings) {
      const isConfirmed = await ask(
        "WARNING: All data on the selected drive will be permanently erased.\n\nAre you sure you want to continue?", 
        { title: "Confirm Data Erasure", kind: "warning" }
      );
      if (!isConfirmed) return;
    }

    setIsFlashing(true);
    setFlashProgress(0);
    setFlashStatus("Initializing engine...");
    setSpeed("");
    setErrorMsg(null);

    await setupListener();
    try {
      await invoke("flash_drive", { 
        deviceId: selectedDrive, 
        isoPath: isoFile, 
        verify: verifyData 
      });
    } catch (err) {
      setErrorMsg(err.toString());
      setIsFlashing(false);
    }
  };

  const handleCancel = async () => {
    if (!skipWarnings) {
      const isConfirmed = await ask(
        "WARNING: Canceling the process right now may leave your USB drive in a corrupted and unusable state until restored.\n\nAre you sure you want to abort?", 
        { title: "Confirm Cancellation", kind: "warning" }
      );
      if (!isConfirmed) return;
    }

    try {
      await invoke("cancel_flash");
      setIsFlashing(false);
      setErrorMsg("Process aborted by user. You may need to use 'Restore Drive' to fix the USB.");
    } catch (err) {
      console.error(err);
    }
  };

  const handleRestore = async () => {
    if (!selectedDrive) return;
    
    if (!skipWarnings) {
      const isConfirmed = await ask(
        "WARNING: This will completely wipe the selected drive to restore it to a single partition.\n\nContinue?", 
        { title: "Confirm Drive Restore", kind: "warning" }
      );
      if (!isConfirmed) return;
    }

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

      {/* Top Right Header Controls */}
      <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
        <button 
          onClick={() => window.open('https://github.com/ah-REE/zozstry', '_blank')} 
          className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-pink-400 hover:bg-pink-500/10 hover:border-pink-500/30 transition-all shadow-lg cursor-pointer" 
          title="Donate / Support"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" /></svg>
        </button>
        <button 
          onClick={() => setShowInfo(true)} 
          className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:bg-blue-500/10 hover:text-blue-400 hover:border-blue-500/30 transition-all shadow-lg cursor-pointer" 
          title="How to use"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        </button>
        <button 
          onClick={() => setShowSettings(true)} 
          className="p-2.5 rounded-xl bg-white/5 border border-white/10 text-neutral-400 hover:bg-white/10 hover:text-white transition-all shadow-lg cursor-pointer" 
          title="Settings"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
        </button>
      </div>

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
              </motion.div>
            )}

            <div className="relative z-10 p-2 flex items-center justify-between min-h-[64px]">
              <div className="pl-4 py-2 flex-1">
                {isFlashing ? (
                  <div className="flex items-center justify-between pr-4 relative z-20">
                    <div className="flex flex-col pointer-events-none">
                      <span className="text-sm font-bold text-white mb-0.5 drop-shadow-md">{flashProgress}% Complete</span>
                      <span className="text-[11px] text-white/80 font-medium truncate">{flashStatus}</span>
                    </div>
                    <div className="flex items-center gap-4">
                      {speed && (
                        <div className="flex flex-col items-end pointer-events-none">
                          <span className="text-[10px] text-white/60 font-mono tracking-widest uppercase mb-0.5">Speed</span>
                          <span className="text-sm font-mono font-bold text-white drop-shadow-md">{speed}</span>
                        </div>
                      )}
                      <button
                        onClick={handleCancel}
                        className="ml-2 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/20 text-red-400 hover:bg-red-500/40 hover:text-red-200 transition-colors cursor-pointer border border-red-500/30"
                        title="Cancel Process"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                      </button>
                    </div>
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

      {/* Info Modal */}
      <AnimatePresence>
        {showInfo && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                  How to use Zozstry
                </h3>
                <button onClick={() => setShowInfo(false)} className="text-neutral-500 hover:text-white transition-colors cursor-pointer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              <div className="p-6 space-y-4 text-sm text-neutral-300">
                <div className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-500/20 text-indigo-400 flex items-center justify-center font-bold">1</span>
                  <p className="pt-1"><strong>Select an ISO:</strong> Click the source image area to browse for your Windows or Linux `.iso` file. Zozstry automatically detects the OS type.</p>
                </div>
                <div className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center font-bold">2</span>
                  <p className="pt-1"><strong>Choose Target:</strong> Select your USB drive from the list. The list actively filters out internal hard drives to prevent accidental data loss.</p>
                </div>
                <div className="flex gap-4">
                  <span className="flex-shrink-0 w-8 h-8 rounded-full bg-yellow-500/20 text-yellow-400 flex items-center justify-center font-bold">3</span>
                  <p className="pt-1"><strong>Ignite:</strong> Click Flash Drive. Zozstry handles 4GB+ FAT32 limits natively using an Inverted Phantom Architecture for Windows.</p>
                </div>
                <div className="flex gap-4 mt-6 p-4 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-xs text-red-300"><strong>Note:</strong> To return a multi-partition bootable USB back to a normal storage drive, use the "Restore Drive" button.</p>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {showSettings && (
          <motion.div 
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-6"
          >
            <motion.div 
              initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
              className="w-full max-w-md bg-[#0a0a0c] border border-white/10 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                  <svg className="w-5 h-5 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                  Preferences
                </h3>
                <button onClick={() => setShowSettings(false)} className="text-neutral-500 hover:text-white transition-colors cursor-pointer">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
              </div>
              
              <div className="p-6 space-y-4">
                {/* LOCKED: Debug Console */}
                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5 opacity-50 pointer-events-none">
                  <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">Enable Debug Console</span>
                      <span className="text-[9px] font-bold uppercase tracking-wider text-yellow-400 px-1.5 py-0.5 bg-yellow-500/10 rounded-md border border-yellow-500/20">Coming Soon</span>
                    </div>
                    <span className="text-xs font-medium text-neutral-400 mt-0.5">Show raw backend stdout logs</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={false} disabled />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none rounded-full peer peer-disabled:opacity-50 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-500 after:border-neutral-600 after:border after:rounded-full after:h-5 after:w-5 after:transition-all"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">Skip Safety Warnings</span>
                    <span className="text-xs font-medium text-neutral-400">Bypass flash and cancel prompts</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={skipWarnings} onChange={() => setSkipWarnings(!skipWarnings)} />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-neutral-500 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-500"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">Force GPT Partitioning</span>
                    <span className="text-xs font-medium text-neutral-400">Bypass MBR for strict UEFI motherboards</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={forceGpt} onChange={() => setForceGpt(!forceGpt)} />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-neutral-500 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl border border-white/5">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-white">Auto-Verify Data Integrity</span>
                    <span className="text-xs font-medium text-neutral-400">Enable verification switch by default</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input type="checkbox" className="sr-only peer" checked={autoVerify} onChange={() => setAutoVerify(!autoVerify)} />
                    <div className="w-11 h-6 bg-black/40 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-neutral-300 after:border-neutral-500 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-500"></div>
                  </label>
                </div>

                {/* LOCKED: Persistent Storage */}
                <div className="flex flex-col p-3 bg-white/5 rounded-xl border border-white/5 opacity-50 pointer-events-none">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex flex-col">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">Persistent Storage</span>
                        <span className="text-[10px] text-blue-400 px-1.5 py-0.5 bg-blue-500/10 rounded-md border border-blue-500/20">Linux Only</span>
                        <span className="text-[9px] font-bold uppercase tracking-wider text-yellow-400 px-1.5 py-0.5 bg-yellow-500/10 rounded-md border border-yellow-500/20">Coming Soon</span>
                      </div>
                      <span className="text-xs font-medium text-neutral-400 mt-0.5">Allocate space for live OS data</span>
                    </div>
                    <span className="text-sm font-bold text-white/50 bg-black/30 px-3 py-1 rounded-lg border border-white/10">0 GB</span>
                  </div>
                  <input 
                    type="range" 
                    min="0" 
                    max="64" 
                    step="1"
                    value={0} 
                    disabled
                    className="w-full h-1.5 bg-black/40 rounded-lg appearance-none cursor-not-allowed focus:outline-none grayscale"
                  />
                  <div className="flex justify-between text-[10px] text-neutral-500 mt-2 font-mono font-medium">
                    <span>0GB</span>
                    <span>32GB</span>
                    <span>64GB</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <style dangerouslySetInnerHTML={{__html: `
        :root, html, body, #root {
          background-color: #0a0a0c;
          margin: 0;
          padding: 0;
          height: 100vh;
          width: 100vw;
          overflow: hidden !important;
          overscroll-behavior: none !important;
          -webkit-user-select: none;
          user-select: none;
          -webkit-user-drag: none;
        }
        .allow-select {
          -webkit-user-select: text;
          user-select: text;
        }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.2); }
        
        input[type=range]::-webkit-slider-thumb {
          -webkit-appearance: none;
          height: 16px;
          width: 16px;
          border-radius: 50%;
          background: #3b82f6;
          box-shadow: 0 0 10px rgba(59, 130, 246, 0.5);
          cursor: pointer;
          margin-top: -5px;
        }
        input[type=range]::-webkit-slider-runnable-track {
          width: 100%;
          height: 6px;
          cursor: pointer;
          background: rgba(0,0,0,0.4);
          border-radius: 4px;
        }
      `}} />
    </main>
  );
}