import './assets/fonts/roboto.css';
import './styles/index.scss';
import './icha-panel.css';

document.body.innerHTML = `
  <div id="portals"></div>

  <div id="Main" class="left-column-shown left-column-open right-column-open">
    <div id="LeftColumn">
      <div class="left-header">
        <button class="round-btn">☰</button>
        <div class="search-input">Search</div>
      </div>

      <div class="chat-list">
        <div class="chat selected">
          <div class="avatar">I</div>
          <div class="chat-info">
            <div class="chat-title">🅒🅗🅘🅖🅖🅐🅢😼🔥</div>
            <div class="chat-subtitle">Icha Panel connected</div>
          </div>
          <div class="chat-time">now</div>
        </div>
      </div>
    </div>

    <div id="MiddleColumn">
      <div class="MiddleHeader">
        <div class="avatar small">I</div>
        <div class="header-info">
          <div class="title">🅒🅗🅘🅖🅖🅐🅢😼🔥</div>
          <div class="subtitle">Icha admin panel</div>
        </div>
        <button class="round-btn">🔍</button>
        <button class="round-btn">⋮</button>
      </div>

      <div class="pinned-bar">
        <b>Pinned message</b>
        <span>Beat me in Sudoku 🏆</span>
      </div>

      <div class="messages">
        <div class="bubble incoming">
          <b>Icha</b>
          <p>Telegram UI-only mode is running.</p>
          <small>now</small>
        </div>

        <div class="bubble outgoing">
          <p>Now we can connect our bot API here.</p>
          <small>now ✓✓</small>
        </div>
      </div>

      <div class="composer">
        <button>😊</button>
        <input placeholder="Message" />
        <button>📎</button>
        <button>➤</button>
      </div>
    </div>

    <div id="RightColumn-wrapper">
      <div id="RightColumn">
        <div class="RightHeader">
          <button class="round-btn">×</button>
          <h3>Group Info</h3>
          <button class="round-btn">✎</button>
        </div>

        <div class="profile">
          <div class="avatar big">I</div>
          <h2>🅒🅗🅘🅖🅖🅐🅢😼🔥</h2>
          <p>Icha managed group</p>
        </div>

        <div class="info-card">
          <div class="info-row">ⓘ <span>Group settings</span></div>
          <div class="info-row">🛡 <span>Moderation</span></div>
          <div class="info-row">🤖 <span>AI settings</span></div>
          <div class="info-row">📜 <span>Rules</span></div>
        </div>
      </div>
    </div>
  </div>
`;