// Runs in the ISOLATED world context of web.whatsapp.com
// Handles DOM construction, UI state, country mapping, filtering, and Excel export.

console.log("[WA Extractor] Content script loaded.");

// Country Calling Codes Map
const countryCodes = {
  "1": "USA / Canada", "7": "Russia / Kazakhstan", "20": "Egypt", "27": "South Africa",
  "30": "Greece", "31": "Netherlands", "32": "Belgium", "33": "France", "34": "Spain",
  "36": "Hungary", "39": "Italy", "40": "Romania", "41": "Switzerland", "43": "Austria",
  "44": "United Kingdom", "45": "Denmark", "46": "Sweden", "47": "Norway", "48": "Poland",
  "49": "Germany", "51": "Peru", "52": "Mexico", "53": "Cuba", "54": "Argentina",
  "55": "Brazil", "56": "Chile", "57": "Colombia", "58": "Venezuela", "60": "Malaysia",
  "61": "Australia", "62": "Indonesia", "63": "Philippines", "64": "New Zealand",
  "65": "Singapore", "66": "Thailand", "81": "Japan", "82": "South Korea", "84": "Vietnam",
  "86": "China", "90": "Turkey", "91": "India", "92": "Pakistan", "93": "Afghanistan",
  "94": "Sri Lanka", "95": "Myanmar", "98": "Iran", "212": "Morocco", "213": "Algeria",
  "216": "Tunisia", "218": "Libya", "220": "Gambia", "233": "Ghana", "234": "Nigeria",
  "254": "Kenya", "256": "Uganda", "260": "Zambia", "263": "Zimbabwe", "351": "Portugal",
  "352": "Luxembourg", "353": "Ireland", "354": "Iceland", "355": "Albania", "358": "Finland",
  "359": "Bulgaria", "370": "Lithuania", "371": "Latvia", "372": "Estonia", "380": "Ukraine",
  "381": "Serbia", "382": "Montenegro", "385": "Croatia", "386": "Slovenia", "387": "Bosnia and Herzegovina",
  "420": "Czech Republic", "421": "Slovakia", "501": "Belize", "502": "Guatemala", "503": "El Salvador",
  "504": "Honduras", "505": "Nicaragua", "506": "Costa Rica", "507": "Panama", "591": "Bolivia",
  "593": "Ecuador", "595": "Paraguay", "598": "Uruguay", "852": "Hong Kong", "853": "Macau",
  "855": "Cambodia", "856": "Laos", "880": "Bangladesh", "886": "Taiwan", "960": "Maldives",
  "961": "Lebanon", "962": "Jordan", "963": "Syria", "964": "Iraq", "965": "Kuwait",
  "966": "Saudi Arabia", "967": "Yemen", "968": "Oman", "970": "Palestine", "971": "United Arab Emirates",
  "972": "Israel", "973": "Bahrain", "974": "Qatar", "977": "Nepal", "992": "Tajikistan",
  "993": "Turkmenistan", "994": "Azerbaijan", "995": "Georgia", "996": "Kyrgyzstan",
  "998": "Uzbekistan"
};

// Sort prefixes in descending order of length to prevent partial matching (e.g. 212 vs 2)
const sortedPrefixes = Object.keys(countryCodes).sort((a, b) => b.length - a.length);

function getCountryFromPhone(phone) {
  if (!phone) return 'Unknown';
  const cleanPhone = phone.replace(/\D/g, '');
  for (const prefix of sortedPrefixes) {
    if (cleanPhone.startsWith(prefix)) {
      return countryCodes[prefix];
    }
  }
  return 'Other / International';
}

// Extracted Data State
let dbData = {
  myJid: '',
  contacts: [],
  chats: [],
  groups: [],
  debug: {
    rawGroupSample: '',
    rawContactSample: '',
    groupsCount: 0,
    contactsCount: 0
  }
};

// Map of contacts keyed by JID for quick lookups
let contactMap = new Map();

// Filter State
let currentSource = 'all-saved'; // all-saved, all-unsaved, chat-list, or group JID
let excludeAdmins = false;
let excludeMe = true;
let exportFormat = 'xlsx'; // xlsx, csv, json
let searchQuery = '';
let filteredResults = [];

// Date Filter State
let datePreset = 'lifetime'; // lifetime, 7days, 30days, custom
let startDateVal = '';
let endDateVal = '';

// DOM Elements
let fabEl = null;
let overlayEl = null;
let drawerEl = null;

// Initialize after DOM loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

function init() {
  // Prevent duplicate insertion
  if (document.getElementById('wa-extractor-fab')) return;
  
  createUI();
  setupEventListeners();
  console.log("[WA Extractor] UI successfully created and injected.");
}

// Fetch data from main world script
function fetchWhatsAppWebData() {
  return new Promise((resolve, reject) => {
    const onResponse = (event) => {
      window.removeEventListener('WA_EXTRACT_RESPONSE', onResponse);
      const { success, data, error } = event.detail || {};
      if (success) {
        resolve(data);
      } else {
        reject(new Error(error || "Could not read WhatsApp database."));
      }
    };
    window.addEventListener('WA_EXTRACT_RESPONSE', onResponse);
    window.dispatchEvent(new CustomEvent('WA_EXTRACT_REQUEST', { detail: { action: 'getData' } }));
  });
}

function createUI() {
  // 1. Create Floating Action Button (FAB)
  fabEl = document.createElement('button');
  fabEl.id = 'wa-extractor-fab';
  fabEl.title = 'Open WhatsApp Number Extractor';
  fabEl.innerHTML = `
    <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
    </svg>
  `;
  document.body.appendChild(fabEl);

  // 2. Create Overlay
  overlayEl = document.createElement('div');
  overlayEl.id = 'wa-extractor-overlay';
  document.body.appendChild(overlayEl);

  // 3. Create Sidebar Drawer
  drawerEl = document.createElement('div');
  drawerEl.id = 'wa-extractor-drawer';
  drawerEl.innerHTML = `
    <div class="wa-header">
      <div class="wa-header-top">
        <h2 class="wa-title">WhatsApp Extractor</h2>
        <button class="wa-close-btn" id="wa-extractor-close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <polyline points="6 6 18 18"></polyline>
          </svg>
        </button>
      </div>
      
      <div class="wa-stats-grid">
        <div class="wa-stat-card">
          <div class="wa-stat-val" id="wa-stat-total">0</div>
          <div class="wa-stat-lbl">Total</div>
        </div>
        <div class="wa-stat-card">
          <div class="wa-stat-val" id="wa-stat-saved">0</div>
          <div class="wa-stat-lbl">In Contacts</div>
        </div>
        <div class="wa-stat-card">
          <div class="wa-stat-val" id="wa-stat-unsaved">0</div>
          <div class="wa-stat-lbl">Unsaved</div>
        </div>
      </div>
    </div>
    
    <div class="wa-body" id="wa-extractor-body">
      <div class="wa-loading-state" id="wa-loading" style="text-align: center; padding: 40px 0;">
        <div class="wa-spinner" style="margin: 0 auto 16px auto;"></div>
        <p style="color: var(--wa-text-muted); font-size: 14px;">Reading local WhatsApp database...</p>
      </div>
      
      <div class="wa-error-state" id="wa-error" style="display: none; text-align: center; padding: 40px 0;">
        <p style="color: #fb7185; font-size: 14px; margin-bottom: 16px;" id="wa-error-msg">Failed to load data.</p>
        <button class="wa-action-btn" id="wa-retry-btn" style="padding: 8px 16px; font-size: 13px; margin: 0 auto;">Retry</button>
      </div>

      <div class="wa-content-section" id="wa-main-controls" style="display: none; flex-direction: column; gap: 20px; flex: 1;">
        <div>
          <label class="wa-label">Select Source</label>
          <select class="wa-select" id="wa-source-select">
            <option value="all-saved">All Saved Contacts</option>
            <option value="all-unsaved">All Unsaved Contacts</option>
            <option value="chat-list">Active Chat List (Direct Messages)</option>
            <optgroup label="Groups" id="wa-groups-optgroup">
              <!-- Loaded dynamically -->
            </optgroup>
          </select>
        </div>

        <!-- Date Filter Sub-section (Dynamic) -->
        <div id="wa-date-filter-container" style="display: none; flex-direction: column; gap: 12px; background: rgba(255, 255, 255, 0.02); padding: 12px; border-radius: 10px; border: 1px solid var(--wa-border);">
          <div>
            <label class="wa-label" style="margin-bottom: 6px;">Last Active Range</label>
            <select class="wa-select" id="wa-date-preset-select" style="padding: 8px 12px;">
              <option value="lifetime">All Time (Lifetime)</option>
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="custom">Custom Date Range</option>
            </select>
          </div>
          
          <div id="wa-custom-date-range" style="display: none; gap: 10px; align-items: center;">
            <div style="flex: 1;">
              <label class="wa-label" style="font-size: 11px; margin-bottom: 4px;">Start Date</label>
              <input type="date" class="wa-input" id="wa-start-date" style="padding: 6px 10px; font-size: 13px;">
            </div>
            <div style="flex: 1;">
              <label class="wa-label" style="font-size: 11px; margin-bottom: 4px;">End Date</label>
              <input type="date" class="wa-input" id="wa-end-date" style="padding: 6px 10px; font-size: 13px;">
            </div>
          </div>
        </div>

        <div class="wa-options-group">
          <div class="wa-toggle-item" id="wa-toggle-admins-container" style="display: none;">
            <div>
              <div style="font-size: 13px; font-weight: 500;">Exclude Group Admins</div>
              <div style="font-size: 11px; color: var(--wa-text-muted);">Exclude group administrators from the list</div>
            </div>
            <label class="wa-switch">
              <input type="checkbox" id="wa-toggle-admins">
              <span class="wa-slider"></span>
            </label>
          </div>

          <div class="wa-toggle-item">
            <div>
              <div style="font-size: 13px; font-weight: 500;">Exclude My Number</div>
              <div style="font-size: 11px; color: var(--wa-text-muted);">Do not extract your logged-in number</div>
            </div>
            <label class="wa-switch">
              <input type="checkbox" id="wa-toggle-me" checked>
              <span class="wa-slider"></span>
            </label>
          </div>
        </div>

        <div>
          <label class="wa-label">Search</label>
          <input type="text" class="wa-input" id="wa-search-input" placeholder="Search number, name, or country...">
        </div>

        <div>
          <label class="wa-label">Download Format</label>
          <div class="wa-format-grid">
            <button class="wa-format-btn active" data-format="xlsx">XLSX (Excel)</button>
            <button class="wa-format-btn" data-format="csv">CSV</button>
            <button class="wa-format-btn" data-format="json">JSON</button>
          </div>
        </div>

        <div class="wa-preview-section">
          <div class="wa-preview-header">
            <label class="wa-label" style="margin: 0;">Preview (First 50 rows)</label>
            <span style="font-size: 11px; color: var(--wa-text-muted);" id="wa-preview-count">Showing 0 rows</span>
          </div>
          <div class="wa-preview-container">
            <table class="wa-table" id="wa-preview-table">
              <thead>
                <tr>
                  <th>Country</th>
                  <th>Phone Number</th>
                  <th>Name</th>
                  <th>Saved?</th>
                </tr>
              </thead>
              <tbody id="wa-preview-tbody">
                <!-- Loaded dynamically -->
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    
    <div class="wa-footer">
      <button class="wa-action-btn" id="wa-export-btn" disabled>
        <span>Export Data</span>
      </button>
      
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; margin-top: 8px;">
        <button id="wa-debug-btn" style="background: none; border: none; color: var(--wa-text-muted); font-size: 10px; cursor: pointer; text-decoration: underline;">
          Show Schema Debug
        </button>
        <div class="wa-credit" style="margin: 0;">WhatsApp Web Extractor v1.0</div>
      </div>

      <div id="wa-debug-panel" style="display: none; flex-direction: column; gap: 8px; margin-top: 12px; background: rgba(0, 0, 0, 0.4); border: 1px solid var(--wa-border); border-radius: 8px; padding: 10px;">
        <div style="font-size: 11px; font-weight: 600; color: #fb7185;">Database Diagnostics:</div>
        <div style="font-size: 10px; color: var(--wa-text-muted);" id="wa-debug-stats">Groups: 0, Contacts: 0</div>
        <textarea id="wa-debug-text" readonly style="width: 100%; height: 120px; font-family: monospace; font-size: 9px; background: #0b0f19; color: #34d399; border: 1px solid var(--wa-border); border-radius: 4px; padding: 6px; resize: vertical; box-sizing: border-box; outline: none;"></textarea>
      </div>
    </div>
  `;
  document.body.appendChild(drawerEl);
}

function setupEventListeners() {
  // Toggle Drawer
  fabEl.addEventListener('click', toggleDrawer);
  overlayEl.addEventListener('click', closeDrawer);
  document.getElementById('wa-extractor-close').addEventListener('click', closeDrawer);

  // Retry Button
  document.getElementById('wa-retry-btn').addEventListener('click', loadData);

  // Debug Toggle
  document.getElementById('wa-debug-btn').addEventListener('click', () => {
    const debugPanel = document.getElementById('wa-debug-panel');
    const isShowing = debugPanel.style.display === 'flex';
    debugPanel.style.display = isShowing ? 'none' : 'flex';
    document.getElementById('wa-debug-btn').textContent = isShowing ? 'Show Schema Debug' : 'Hide Schema Debug';
  });

  // Source Selector
  document.getElementById('wa-source-select').addEventListener('change', (e) => {
    currentSource = e.target.value;
    
    // Toggle Admins settings visibility (only for group exports)
    const adminToggleContainer = document.getElementById('wa-toggle-admins-container');
    if (currentSource !== 'all-saved' && currentSource !== 'all-unsaved' && currentSource !== 'chat-list') {
      adminToggleContainer.style.display = 'flex';
    } else {
      adminToggleContainer.style.display = 'none';
    }

    // Toggle Date selector (only for active chats history list)
    const dateFilterContainer = document.getElementById('wa-date-filter-container');
    if (currentSource === 'chat-list') {
      dateFilterContainer.style.display = 'flex';
    } else {
      dateFilterContainer.style.display = 'none';
    }
    
    updateResults();
  });

  // Date Preset Selector
  document.getElementById('wa-date-preset-select').addEventListener('change', (e) => {
    datePreset = e.target.value;
    const customDateRange = document.getElementById('wa-custom-date-range');
    if (datePreset === 'custom') {
      customDateRange.style.display = 'flex';
    } else {
      customDateRange.style.display = 'none';
    }
    updateResults();
  });

  // Custom Date inputs
  document.getElementById('wa-start-date').addEventListener('input', (e) => {
    startDateVal = e.target.value;
    updateResults();
  });
  document.getElementById('wa-end-date').addEventListener('input', (e) => {
    endDateVal = e.target.value;
    updateResults();
  });

  // Admin Switch
  document.getElementById('wa-toggle-admins').addEventListener('change', (e) => {
    excludeAdmins = e.target.checked;
    updateResults();
  });

  // Exclude Me Switch
  document.getElementById('wa-toggle-me').addEventListener('change', (e) => {
    excludeMe = e.target.checked;
    updateResults();
  });

  // Search Input
  document.getElementById('wa-search-input').addEventListener('input', (e) => {
    searchQuery = e.target.value.toLowerCase();
    updateResults();
  });

  // Format Selection
  const formatButtons = document.querySelectorAll('.wa-format-btn');
  formatButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      formatButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      exportFormat = btn.getAttribute('data-format');
    });
  });

  // Export Trigger
  document.getElementById('wa-export-btn').addEventListener('click', exportData);
}

function toggleDrawer() {
  const isOpen = drawerEl.classList.contains('open');
  if (isOpen) {
    closeDrawer();
  } else {
    openDrawer();
  }
}

function openDrawer() {
  fabEl.classList.add('active');
  overlayEl.classList.add('open');
  drawerEl.classList.add('open');
  loadData();
}

function closeDrawer() {
  fabEl.classList.remove('active');
  overlayEl.classList.remove('open');
  drawerEl.classList.remove('open');
}

// Load Data and Update Dropdown
async function loadData() {
  const loadingState = document.getElementById('wa-loading');
  const errorState = document.getElementById('wa-error');
  const mainControls = document.getElementById('wa-main-controls');
  const exportBtn = document.getElementById('wa-export-btn');

  loadingState.style.display = 'block';
  errorState.style.display = 'none';
  mainControls.style.display = 'none';
  exportBtn.disabled = true;

  try {
    const response = await fetchWhatsAppWebData();
    dbData = response;
    
    // Create mapping JID -> Contact
    contactMap.clear();
    dbData.contacts.forEach(c => {
      contactMap.set(c.id, c);
      if (c.phoneId) {
        contactMap.set(c.phoneId, c);
      }
    });

    // Populate Groups Dropdown
    const groupsGroup = document.getElementById('wa-groups-optgroup');
    groupsGroup.innerHTML = '';
    
    // Sort groups alphabetically
    const sortedGroups = [...dbData.groups].sort((a, b) => a.subject.localeCompare(b.subject));
    
    sortedGroups.forEach(g => {
      const option = document.createElement('option');
      option.value = g.id;
      option.textContent = `${g.subject} (${g.participants.length} members)`;
      groupsGroup.appendChild(option);
    });

    // Fill Diagnostics
    const debug = dbData.debug || {};
    document.getElementById('wa-debug-stats').textContent = `Groups: ${dbData.groups.length}, Chats: ${dbData.chats.length}, Contacts: ${dbData.contacts.length}`;
    document.getElementById('wa-debug-text').value = 
      `--- DB METADATA DIAGNOSTICS ---\n` +
      `Logged In User: ${dbData.myJid}\n\n` +
      `[SAMPLE GROUP METADATA]:\n${debug.rawGroupSample}\n\n` +
      `[SAMPLE CONTACT RECORD]:\n${debug.rawContactSample}`;

    loadingState.style.display = 'none';
    mainControls.style.display = 'flex';
    exportBtn.disabled = false;

    updateResults();
  } catch (error) {
    loadingState.style.display = 'none';
    errorState.style.display = 'block';
    document.getElementById('wa-error-msg').textContent = error.message;
  }
}

// Process data, filter, and render preview
function updateResults() {
  let list = [];
  let isGroup = false;
  let activeGroupName = '';

  if (currentSource === 'all-saved') {
    // Filter contacts that are saved (isContact === true), excluding me and group records
    list = dbData.contacts.filter(c => c.isContact && !c.isMe && c.id.endsWith('@c.us'));
  } else if (currentSource === 'all-unsaved') {
    // Filter contacts that are NOT saved, excluding me and group records
    list = dbData.contacts.filter(c => !c.isContact && !c.isMe && c.id.endsWith('@c.us'));
  } else if (currentSource === 'chat-list') {
    // Extract numbers from active chat list (direct messages only, excluding groups/newsletters/broadcasts)
    const nowSec = Math.floor(Date.now() / 1000);
    let startSec = 0;
    let endSec = Infinity;

    if (datePreset === '7days') {
      startSec = nowSec - (7 * 24 * 60 * 60);
    } else if (datePreset === '30days') {
      startSec = nowSec - (30 * 24 * 60 * 60);
    } else if (datePreset === 'custom') {
      if (startDateVal) {
        startSec = Math.floor(new Date(startDateVal + 'T00:00:00').getTime() / 1000);
      }
      if (endDateVal) {
        endSec = Math.floor(new Date(endDateVal + 'T23:59:59').getTime() / 1000);
      }
    }

    dbData.chats.forEach(chat => {
      const chatJid = chat.id;
      
      // Skip groups, broadcasts, status, newsletter threads
      if (chatJid.endsWith('@g.us') || 
          chatJid.endsWith('@broadcast') || 
          chatJid.endsWith('@newsletter') ||
          chatJid === 'status@broadcast') {
        return;
      }

      // Filter by active range timestamp
      const chatTime = chat.t || 0;
      if (chatTime < startSec || chatTime > endSec) {
        return;
      }

      // Cross-reference chat with contact store
      const contact = contactMap.get(chatJid);
      const resolvedPhoneJid = (contact && contact.phoneId) ? contact.phoneId : chatJid;
      
      // Exclude me check
      const cleanMe = dbData.myJid ? dbData.myJid.split('@')[0] : '';
      const cleanP = chatJid.split('@')[0];
      const cleanResolved = resolvedPhoneJid.split('@')[0];
      const isMe = cleanP === cleanMe || cleanResolved === cleanMe || chatJid === dbData.myJid || resolvedPhoneJid === dbData.myJid;
      
      if (excludeMe && isMe) return;

      list.push({
        id: resolvedPhoneJid,
        lid: chatJid,
        name: contact ? contact.name : '',
        pushname: contact ? contact.pushname : '',
        isContact: contact ? contact.isContact : false,
        isMe: isMe
      });
    });
  } else {
    // Group extraction
    isGroup = true;
    const groupJid = currentSource;
    const group = dbData.groups.find(g => g.id === groupJid);
    
    if (group) {
      activeGroupName = group.subject;
      group.participants.forEach(p => {
        if (excludeAdmins && p.isAdmin) return;

        const contact = contactMap.get(p.id);
        const resolvedPhoneJid = (contact && contact.phoneId) ? contact.phoneId : p.id;
        
        const cleanMe = dbData.myJid ? dbData.myJid.split('@')[0] : '';
        const cleanP = p.id ? p.id.split('@')[0] : '';
        const cleanResolved = resolvedPhoneJid ? resolvedPhoneJid.split('@')[0] : '';
        const isMe = cleanP === cleanMe || cleanResolved === cleanMe || p.id === dbData.myJid || resolvedPhoneJid === dbData.myJid;
        
        if (excludeMe && isMe) return;

        list.push({
          id: resolvedPhoneJid,
          lid: p.id,
          name: contact ? contact.name : '',
          pushname: contact ? contact.pushname : '',
          isContact: contact ? contact.isContact : false,
          isMe: isMe
        });
      });
    }
  }

  // Map to final columns format
  const mappedList = list.map(item => {
    // Phone Number & JID Info
    const rawJid = item.id;
    const prefixNum = rawJid.split('@')[0];
    const cleanNumber = prefixNum.replace(/\D/g, '');
    const country = getCountryFromPhone(cleanNumber);

    // Resolve name priority: Saved Contact Name > Profile Name > Empty
    let resolvedName = item.name.trim();
    if (!resolvedName && item.pushname) {
      resolvedName = item.pushname.trim();
    }

    return {
      country: country,
      phoneNumber: cleanNumber,
      name: resolvedName || 'N/A',
      groupName: isGroup ? activeGroupName : 'N/A',
      isSaved: item.isContact
    };
  });

  // Apply Search Query Filter
  filteredResults = mappedList.filter(item => {
    if (!searchQuery) return true;
    return item.phoneNumber.includes(searchQuery) || 
           item.name.toLowerCase().includes(searchQuery) || 
           item.country.toLowerCase().includes(searchQuery);
  });

  // Calculate Statistics
  const total = filteredResults.length;
  const saved = filteredResults.filter(i => i.isSaved).length;
  const unsaved = total - saved;

  document.getElementById('wa-stat-total').textContent = total;
  document.getElementById('wa-stat-saved').textContent = saved;
  document.getElementById('wa-stat-unsaved').textContent = unsaved;

  // Render Table Preview
  const tbody = document.getElementById('wa-preview-tbody');
  tbody.innerHTML = '';

  const previewCount = Math.min(50, filteredResults.length);
  document.getElementById('wa-preview-count').textContent = `Showing ${previewCount} of ${total} rows`;

  for (let i = 0; i < previewCount; i++) {
    const item = filteredResults[i];
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHTML(item.country)}</td>
      <td>+${item.phoneNumber}</td>
      <td title="${escapeHTML(item.name)}">${escapeHTML(item.name)}</td>
      <td>
        <span class="wa-badge ${item.isSaved ? 'wa-badge-saved' : 'wa-badge-unsaved'}">
          ${item.isSaved ? 'Yes' : 'No'}
        </span>
      </td>
    `;
    tbody.appendChild(tr);
  }

  if (filteredResults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--wa-text-muted); padding: 20px;">No numbers match your criteria.</td></tr>`;
  }

  // Update Action Button Text
  const exportBtn = document.getElementById('wa-export-btn');
  exportBtn.querySelector('span').textContent = `Export ${total} Numbers`;
  exportBtn.disabled = total === 0;
}

// Utility to escape HTML entities
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}

// Generate files for export
function exportData() {
  if (filteredResults.length === 0) return;

  const dataToExport = filteredResults.map(item => ({
    "Country": item.country,
    "Phone Number": `+${item.phoneNumber}`,
    "Phone Number (no +)": item.phoneNumber,
    "Name": item.name,
    "Group Name": item.groupName,
    "Is in Contact": item.isSaved ? "true" : "false"
  }));

  const timestamp = new Date().toISOString().slice(0, 10);
  const sourceName = currentSource === 'all-saved' ? 'saved_contacts' : 
                     currentSource === 'all-unsaved' ? 'unsaved_contacts' : 
                     currentSource === 'chat-list' ? 'chat_list_contacts' : 'group_members';
  const fileName = `whatsapp_${sourceName}_${timestamp}`;

  if (exportFormat === 'json') {
    const jsonString = JSON.stringify(dataToExport, null, 2);
    downloadFile(jsonString, 'application/json', `${fileName}.json`);
  } else if (exportFormat === 'csv') {
    // Generate CSV string with UTF-8 BOM
    const headers = ["Country", "Phone Number", "Phone Number (no +)", "Name", "Group Name", "Is in Contact"];
    const csvRows = [headers.join(",")];
    
    dataToExport.forEach(row => {
      const values = [
        escapeCSV(row["Country"]),
        escapeCSV(row["Phone Number"]),
        escapeCSV(row["Phone Number (no +)"]),
        escapeCSV(row["Name"]),
        escapeCSV(row["Group Name"]),
        escapeCSV(row["Is in Contact"])
      ];
      csvRows.push(values.join(","));
    });
    
    const csvContent = "\uFEFF" + csvRows.join("\n");
    downloadFile(csvContent, 'text/csv;charset=utf-8;', `${fileName}.csv`);
  } else if (exportFormat === 'xlsx') {
    try {
      if (typeof XLSX === 'undefined') {
        alert("Excel export library is still loading. Please try again in a few seconds.");
        return;
      }
      
      const ws = XLSX.utils.json_to_sheet(dataToExport);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "WhatsApp Extracted");
      
      // Write to binary
      const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'binary' });
      
      // Convert to ArrayBuffer
      const buf = new ArrayBuffer(wbout.length);
      const view = new Uint8Array(buf);
      for (let i = 0; i < wbout.length; i++) {
        view[i] = wbout.charCodeAt(i) & 0xFF;
      }
      
      const blob = new Blob([buf], { type: "application/octet-stream" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${fileName}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("[WA Extractor] Excel export failed:", e);
      alert("Excel export failed. Please try exporting as CSV instead.");
    }
  }
}

// Download File helper
function downloadFile(content, contentType, fileName) {
  const blob = new Blob([content], { type: contentType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// CSV escaping helper
function escapeCSV(val) {
  if (val === undefined || val === null) return '';
  const str = String(val);
  return '"' + str.replace(/"/g, '""') + '"';
}
