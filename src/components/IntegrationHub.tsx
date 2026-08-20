import React, { useState } from 'react';
import { Branch, PositionShift, LineMessage } from '../types';
import { ZONE_CONFIGS } from '../data/mockData';
import { MapPin, Calendar, MessageSquare, Smartphone, ExternalLink, CheckCircle, HelpCircle, Layers, FileText, ArrowRight } from 'lucide-react';

interface IntegrationHubProps {
  branches: Branch[];
  shifts: PositionShift[];
  sharedPostText?: string;
}

export const IntegrationHub: React.FC<IntegrationHubProps> = ({ branches, shifts, sharedPostText }) => {
  const [activeTab, setActiveTab] = useState<'maps' | 'calendar' | 'line'>('line');

  // LINE Bot Interactive Chat State
  const [lineMessages, setLineMessages] = useState<LineMessage[]>([
    {
      id: 'msg-1',
      sender: 'bot',
      text: '🐾 歡迎來到【浪浪家園 志工排班服務 Bot】！您可以點擊下方選單進行搶班與查詢排班。',
      time: '10:00',
      quickReplies: ['點我登記志工搶班', '查詢明日值班名單', '開啟 Google 地圖導航']
    }
  ]);

  const [inputMsg, setInputMsg] = useState('');

  // Selected Branch for Map Simulator
  const [selectedMapBranch, setSelectedMapBranch] = useState<Branch>(branches[0]);
  const [selectedZoneMap, setSelectedZoneMap] = useState<string>('dog');

  const handleSendLineUserMsg = (text: string) => {
    const timeStr = new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' });
    const userMsg: LineMessage = {
      id: `usr-${Date.now()}`,
      sender: 'user',
      text,
      time: timeStr
    };

    setLineMessages(prev => [...prev, userMsg]);

    // Simulate Bot Response
    setTimeout(() => {
      let botResponseText = '';
      let cardData = undefined;

      if (text.includes('搶班') || text.includes('登記')) {
        botResponseText = '🐶【急招！本日待補志工班次】\n📍 總部園區 - B戶外草坪放風班 (缺 2 人)\n請點擊卡片直接在 Google 預約網頁完成登記：';
        cardData = {
          title: '早班大狗運動場牽繩放風',
          description: '地點：總部園區 (點擊喚醒 Google Maps 導航)\n時間：10:00 - 13:00',
          buttonText: '線上搶班預約 (Google Calendar)',
          buttonAction: 'https://calendar.google.com/calendar/appointments'
        };
      } else if (text.includes('明日') || text.includes('查班')) {
        botResponseText = '📅【明日 10/16 志工值班名單】\n• 早班貓捨：王嘉偉、林雅婷 (已滿班)\n• 午班大狗場：黃秀玲 (尚缺 1 人)\n• 醫療區：張志豪 (專業支援中)';
      } else if (text.includes('導航') || text.includes('地圖')) {
        botResponseText = '🗺️【園區 Google 地圖導航】\n點擊下方按鈕自動開啟 Google Maps App，系統將為您指引至『浪浪總部園區 B棟入口』：';
        cardData = {
          title: '浪浪總部園區 (新店本館)',
          description: '地址：新北市新店區安興路88號 (浪浪之丘)',
          buttonText: '開啟 Google Maps 導航',
          buttonAction: branches[0].googleMapsUrl
        };
      } else {
        botResponseText = `🤖 收到！指引已紀錄。如有急事請撥打社工電話：02-2345-6789。`;
      }

      const botMsg: LineMessage = {
        id: `bot-${Date.now()}`,
        sender: 'bot',
        text: botResponseText,
        time: timeStr,
        card: cardData,
        quickReplies: ['點我登記志工搶班', '查詢明日值班名單', '開啟 Google 地圖導航']
      };

      setLineMessages(prev => [...prev, botMsg]);
    }, 600);
  };

  return (
    <div className="space-y-8 py-6 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto">
      
      {/* Header Tabs */}
      <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-[#5A5A40]/12 shadow-xs space-y-4">
        <div>
          <h2 className="text-2xl font-bold font-serif italic text-[#5A5A40] flex items-center gap-2">
            <span>Google 地圖 + Google 日曆 + LINE 串聯架構模擬器</span>
          </h2>
          <p className="text-xs text-slate-500 mt-1 font-sans">
            無需寫複雜程式，運用 Google 日曆「預約時間表」與 LINE 官方帳號圖文選單，打造 100% 免費、零門檻的志工管理系統。
          </p>
        </div>

        <div className="flex border-b border-[#5A5A40]/10 space-x-6 text-xs font-bold font-sans">
          <button
            onClick={() => setActiveTab('line')}
            className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
              activeTab === 'line'
                ? 'border-[#5A5A40] text-[#5A5A40]'
                : 'border-transparent text-slate-500 hover:text-[#5A5A40]'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>1. LINE 官方帳號與圖文選單模擬</span>
          </button>

          <button
            onClick={() => setActiveTab('maps')}
            className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
              activeTab === 'maps'
                ? 'border-[#5A5A40] text-[#5A5A40]'
                : 'border-transparent text-slate-500 hover:text-[#5A5A40]'
            }`}
          >
            <MapPin className="w-4 h-4" />
            <span>2. Google 地圖場域據點對應</span>
          </button>

          <button
            onClick={() => setActiveTab('calendar')}
            className={`pb-3 transition border-b-2 flex items-center gap-2 cursor-pointer ${
              activeTab === 'calendar'
                ? 'border-[#5A5A40] text-[#5A5A40]'
                : 'border-transparent text-slate-500 hover:text-[#5A5A40]'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>3. Google 日曆預約時間表設定</span>
          </button>
        </div>
      </div>

      {/* TAB 1: LINE Integration Simulator */}
      {activeTab === 'line' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left: Interactive Phone Mockup */}
          <div className="lg:col-span-5 flex justify-center">
            <div className="w-full max-w-sm bg-[#323223] rounded-[44px] p-3.5 shadow-2xl border-4 border-[#484833] relative">
              {/* Camera notch */}
              <div className="w-32 h-5 bg-[#323223] rounded-b-xl mx-auto z-20 relative flex items-center justify-center">
                <div className="w-3 h-3 bg-[#484833] rounded-full"></div>
              </div>

              {/* Phone Screen Container */}
              <div className="bg-[#8cabd9] rounded-[32px] overflow-hidden flex flex-col h-[580px] relative">
                
                {/* LINE Header */}
                <div className="bg-[#2a384c] text-white p-3 flex items-center justify-between text-xs font-bold">
                  <div className="flex items-center space-x-2">
                    <div className="w-7 h-7 rounded-full bg-[#5A5A40] flex items-center justify-center text-white font-bold">
                      🐾
                    </div>
                    <div>
                      <p>浪浪家園 志工服務 Bot</p>
                      <p className="text-[9px] text-[#E6E2D3]">LINE 官方帳號 @line-calendar</p>
                    </div>
                  </div>
                  <span className="text-[10px] bg-[#5A5A40] px-2 py-0.5 rounded-full">官方認證</span>
                </div>

                {/* Chat Messages Body */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3 text-xs font-sans">
                  {lineMessages.map((msg) => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${msg.sender === 'user' ? 'items-end' : 'items-start'}`}
                    >
                      <div
                        className={`max-w-[85%] p-3 rounded-2xl leading-relaxed whitespace-pre-wrap ${
                          msg.sender === 'user'
                            ? 'bg-[#85e249] text-slate-900 rounded-tr-none'
                            : 'bg-white text-slate-800 rounded-tl-none shadow-xs'
                        }`}
                      >
                        {msg.text}

                        {/* Card Component if present */}
                        {msg.card && (
                          <div className="mt-2 bg-[#f5f5f0] p-2.5 rounded-xl border border-[#5A5A40]/15 text-xs space-y-1">
                            <p className="font-bold text-[#5A5A40]">{msg.card.title}</p>
                            <p className="text-[10px] text-slate-500">{msg.card.description}</p>
                            <a
                              href={msg.card.buttonAction}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="mt-2 block text-center bg-[#5A5A40] text-white font-bold py-1.5 px-3 rounded-full text-[10px]"
                            >
                              {msg.card.buttonText}
                            </a>
                          </div>
                        )}
                      </div>

                      <span className="text-[9px] text-slate-600 mt-1 px-1">{msg.time}</span>
                    </div>
                  ))}
                </div>

                {/* Rich Menu Simulator (LINE 圖文選單) */}
                <div className="bg-slate-100 border-t border-slate-200 p-2 space-y-1 font-sans">
                  <p className="text-[10px] font-bold text-center text-slate-500 uppercase tracking-wider">
                    ▼ LINE 圖文選單 (點擊按鈕進行模擬互動)
                  </p>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      onClick={() => handleSendLineUserMsg('點我登記志工搶班')}
                      className="bg-[#5A5A40] hover:bg-[#484833] text-white p-2.5 rounded-xl font-bold text-xs text-center shadow-xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>🐾 1. 志工搶班登記</span>
                    </button>

                    <button
                      onClick={() => handleSendLineUserMsg('查詢明日值班名單')}
                      className="bg-[#5A5A40] hover:bg-[#484833] text-white p-2.5 rounded-xl font-bold text-xs text-center shadow-xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>📅 2. 查明日值班班表</span>
                    </button>

                    <button
                      onClick={() => handleSendLineUserMsg('開啟 Google 地圖導航')}
                      className="bg-[#5A5A40] hover:bg-[#484833] text-white p-2.5 rounded-xl font-bold text-xs text-center shadow-xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>🗺️ 3. Google地圖導航</span>
                    </button>

                    <button
                      onClick={() => handleSendLineUserMsg('緊急缺工回覆')}
                      className="bg-rose-700 hover:bg-rose-800 text-white p-2.5 rounded-xl font-bold text-xs text-center shadow-xs cursor-pointer flex items-center justify-center gap-1"
                    >
                      <span>🚨 4. 缺工緊急通報</span>
                    </button>
                  </div>
                </div>

              </div>
            </div>
          </div>

          {/* Right: Setup Guide */}
          <div className="lg:col-span-7 space-y-6">

            <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-[#5A5A40]/12 shadow-xs space-y-4">
              <h3 className="font-bold font-serif text-xl text-[#5A5A40] flex items-center gap-2">
                <span>💬 如何建立 LINE 與 Google 日曆串聯？</span>
              </h3>

              <div className="space-y-4 text-xs text-slate-600 font-sans">
                <div className="p-5 bg-[#f5f5f0] rounded-2xl border border-[#5A5A40]/15 space-y-2">
                  <h4 className="font-bold text-[#5A5A40] flex items-center gap-1.5 text-sm">
                    <CheckCircle className="w-4 h-4 text-[#5A5A40]" />
                    方法 1：免費圖文選單綁定 Google 預約網址 (最推薦)
                  </h4>
                  <p>1. 於 Google 日曆建立「預約時間表」後，複製該線上預約網頁連結。</p>
                  <p>2. 登入 LINE 官方帳號後台 (LINE Official Account Manager) → 進入【圖文選單】建立。</p>
                  <p>3. 設定選單按鈕叫「點我登記志工排班」，動作類型選擇【網址】，貼上 Google 預約網址即可！</p>
                </div>

                <div className="p-5 bg-[#fdfdfb] rounded-2xl border border-[#5A5A40]/15 space-y-2">
                  <h4 className="font-bold text-[#5A5A40] flex items-center gap-1.5 text-sm">
                    <CheckCircle className="w-4 h-4 text-[#5A5A40]" />
                    方法 2：加裝免費 LINE 機器人 (行事曆聯絡人)
                  </h4>
                  <p>1. 在 LINE 搜尋官方帳號 ID: <code className="bg-[#E6E2D3] px-2 py-0.5 rounded text-[#5A5A40] font-mono font-bold">@line-calendar</code> 加為好友並邀請入群組。</p>
                  <p>2. 志工在群組輸入「@行事曆 明天有誰當班？」，機器人會自動讀取 Google 日曆並回覆名單。</p>
                  <p>3. 時間到達前 1 小時，機器人會自動於群組推播包含 Google Maps 地點的提醒訊息。</p>
                </div>
              </div>
            </div>
          </div>

        </div>
      )}

      {/* TAB 2: Google Maps Zone Map */}
      {activeTab === 'maps' && (
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-[#5A5A40]/12 shadow-xs space-y-6 font-sans">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 border-b border-[#5A5A40]/10 pb-4">
            <div>
              <h3 className="font-bold font-serif text-xl text-[#5A5A40] flex items-center gap-2">
                <MapPin className="w-5 h-5 text-[#5A5A40]" />
                <span>Google 地圖據點與內部場域圖 (Zone Map) 模擬</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">點擊下方場域可檢視對應之 Google 地圖定位與內部建築配置圖</p>
            </div>

            <select
              value={selectedMapBranch.id}
              onChange={e => {
                const b = branches.find(item => item.id === e.target.value);
                if (b) setSelectedMapBranch(b);
              }}
              className="p-2.5 bg-[#f5f5f0] border border-[#5A5A40]/15 rounded-2xl text-xs font-bold text-[#5A5A40] focus:outline-none"
            >
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            
            {/* Map Photo Preview */}
            <div className="md:col-span-7 bg-[#f5f5f0] rounded-[28px] overflow-hidden relative min-h-[300px] flex items-center justify-center border border-[#5A5A40]/12">
              <img
                src={selectedMapBranch.image}
                alt={selectedMapBranch.name}
                className="w-full h-80 object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex flex-col justify-end p-6 text-white space-y-2">
                <span className="text-xs font-bold bg-[#5A5A40] px-3 py-1 rounded-full w-fit">
                  📍 {selectedMapBranch.name}
                </span>
                <p className="text-xs text-slate-200">{selectedMapBranch.address}</p>
                <p className="text-[11px] text-[#E6E2D3] font-semibold">⏰ 開放時間：{selectedMapBranch.openHours}</p>
              </div>
            </div>

            {/* Zone breakdown list */}
            <div className="md:col-span-5 space-y-3">
              <p className="text-xs font-bold text-[#5A5A40] uppercase tracking-wider">園區場域分區 (顏色對應日曆標籤)：</p>
              
              {Object.keys(ZONE_CONFIGS).map(zKey => {
                const zConf = ZONE_CONFIGS[zKey];
                return (
                  <div
                    key={zKey}
                    onClick={() => setSelectedZoneMap(zKey)}
                    className={`p-3.5 rounded-2xl border cursor-pointer transition flex items-center justify-between ${
                      selectedZoneMap === zKey
                        ? `${zConf.bgLight} ${zConf.borderClass} font-bold shadow-2xs`
                        : 'bg-[#fdfdfb] border-[#5A5A40]/10 hover:bg-[#f5f5f0]'
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-2xl">{zConf.icon}</span>
                      <div>
                        <h4 className="text-xs text-slate-800">{zConf.name}</h4>
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${zConf.badgeBg}`}>
                          色彩: {zConf.color}
                        </span>
                      </div>
                    </div>

                    <a
                      href={selectedMapBranch.googleMapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-[#5A5A40] hover:underline font-bold flex items-center gap-0.5"
                    >
                      <span>導航</span>
                      <ExternalLink className="w-3 h-3 text-[#5A5A40]" />
                    </a>
                  </div>
                );
              })}
            </div>

          </div>
        </div>
      )}

      {/* TAB 3: Google Calendar Setup */}
      {activeTab === 'calendar' && (
        <div className="bg-white p-6 sm:p-8 rounded-[32px] border border-[#5A5A40]/12 shadow-xs space-y-6 font-sans">
          <div>
            <h3 className="font-bold font-serif text-xl text-[#5A5A40] flex items-center gap-2">
              <Calendar className="w-5 h-5 text-[#5A5A40]" />
              <span>Google 日曆「預約時間表 (Appointment Schedules)」實務設定指南</span>
            </h3>
            <p className="text-xs text-slate-500 mt-1">
              Google 官方近年推出的免費核心功能，完全不需程式即可產出志工線上報名頁面。
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            
            <div className="p-6 bg-[#f5f5f0] rounded-[28px] border border-[#5A5A40]/15 space-y-3 text-xs text-[#5A5A40]">
              <h4 className="font-bold font-serif text-base flex items-center gap-1.5">
                <span>1. 設定「地點」喚醒 Google Maps</span>
              </h4>
              <p className="text-slate-700">建立班次行程時，點擊【新增地點】，輸入「浪浪家園總部園區」或完整地址。</p>
              <p className="text-[#5A5A40] font-medium pt-1 border-t border-[#5A5A40]/10">
                志工好處：志工用手機點開日曆行程，點擊地址即可自動啟動 Google Maps 導航，避免跑錯據點。
              </p>
            </div>

            <div className="p-6 bg-[#fdfdfb] rounded-[28px] border border-[#5A5A40]/15 space-y-3 text-xs text-[#5A5A40]">
              <h4 className="font-bold font-serif text-base flex items-center gap-1.5">
                <span>2. 依「場域」套用色彩標籤</span>
              </h4>
              <p className="text-slate-700">■ 紅色（貓捨區）：負責貓咪餵食、鏟砂、親人訓練。</p>
              <p className="text-slate-700">■ 綠色（大狗運動場）：負責狗狗牽繩放風、洗澡散步。</p>
              <p className="text-slate-700">■ 藍色（醫療區）：協助獸醫餵藥、環境消毒。</p>
            </div>

          </div>
        </div>
      )}

    </div>
  );
};
