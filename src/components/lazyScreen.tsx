import { lazy } from 'react';

/**
 * 動態載入失敗時顯示的東西。
 *
 * 最常見的原因不是網路，是部署：新版本會產生新的檔名，舊的 chunk 隨即消失，所以
 * 在更新前後那幾秒還開著舊頁面的人，一點下一個分頁就會指向一個已經不存在的檔案。
 * 這也是為什麼出路是「重新整理」—— 那會拿到新的 index.html，指向新的檔名。
 *
 * 另一種是志工在園區用手機、訊號時斷時續。對他們來說這個畫面的意義是「知道要
 * 重試」，而不是對著一片空白猜系統是不是壞了。
 */
const ChunkLoadFailed = () => (
  <div className="bg-white rounded-[32px] border border-[#716053] p-10 text-center space-y-3 font-sans m-6">
    <p className="text-sm font-bold text-[#716053]">這個畫面沒有載入成功</p>
    <p className="text-xs text-slate-500 leading-relaxed">
      最常見的原因是系統剛更新過，重新整理就會取得新版本。
      <br />
      若重整後仍然如此，請聯繫社工督導。
    </p>
    <button
      onClick={() => window.location.reload()}
      className="bg-[#716053] hover:bg-[#5a4d42] text-[#F5E6D0] font-bold text-xs px-5 py-2 rounded-full transition cursor-pointer"
    >
      重新整理
    </button>
  </div>
);

/**
 * React.lazy，但載不到檔案時給出一則訊息，而不是讓整棵樹垮成一片空白。
 *
 * 為什麼不是 error boundary：那需要 class component，而這個專案沒有安裝
 * @types/react，class 的 this.props / this.state 一律解析不出型別。不過就算能寫，
 * 這個做法也比較準 —— error boundary 會連元件內部的執行期錯誤一起接走，把真正的
 * bug 偽裝成「載入失敗，請重新整理」；這裡的 catch 只包住 import 那一個 promise，
 * 接到的必定是取檔案失敗。
 *
 * 失敗的模組會停在這個畫面直到重新整理：React.lazy 會記住第一次的結果，不會自己
 * 重試。這是刻意的 —— 自動重試在部署造成的失敗上永遠不會成功，只會讓使用者對著
 * 一個看似在動、其實不會好的畫面等下去。
 */
export function lazyScreen(loader: () => Promise<{ default: any }>) {
  return lazy(() =>
    loader().catch((error: unknown) => {
      // 留在 console：這類失敗使用者只會回報「打不開」，有這行才分得出是取檔案
      // 失敗還是元件自己爆了。
      console.error('動態載入的區塊未能載入：', error);
      return { default: ChunkLoadFailed };
    })
  );
}
