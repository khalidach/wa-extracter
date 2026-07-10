// Runs in the MAIN world context of web.whatsapp.com
// This gives direct access to the page's localStorage and IndexedDB

console.log("[WA Extractor] Main-world script injected and running.");

// Safely get own WID (WhatsApp ID) from localStorage
function getMyJid() {
  try {
    const rawWid = localStorage.getItem('last-wid-md') || 
                   localStorage.getItem('last-wid') || 
                   localStorage.getItem('remember-me');
    if (rawWid) {
      let parsed = rawWid;
      if (rawWid.startsWith('"') && rawWid.endsWith('"')) {
        parsed = JSON.parse(rawWid);
      }
      // Suffix like :4 or :1 is common in multi-device sessions
      return parsed.split(':')[0];
    }
  } catch (e) {
    console.error("[WA Extractor] Error reading my WID from localStorage:", e);
  }
  return '';
}

// Open IndexedDB and read stores
function openDB(dbName) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function readAllFromStore(db, storeName) {
  return new Promise((resolve) => {
    try {
      if (!db.objectStoreNames.contains(storeName)) {
        resolve([]);
        return;
      }
      const transaction = db.transaction(storeName, 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = (e) => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

// Helper to stringify circular objects safely
function safeStringify(obj, maxDepth = 2, currentDepth = 0) {
  if (obj === null || obj === undefined) return String(obj);
  if (typeof obj !== 'object') {
    if (typeof obj === 'function') return '[Function]';
    return String(obj);
  }
  if (currentDepth >= maxDepth) return '[Object]';
  
  if (Array.isArray(obj)) {
    return '[' + obj.map(item => safeStringify(item, maxDepth, currentDepth + 1)).join(', ') + ']';
  }
  
  const parts = [];
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      try {
        parts.push(`"${key}": ${safeStringify(obj[key], maxDepth, currentDepth + 1)}`);
      } catch (e) {
        parts.push(`"${key}": "[Unserializable]"`);
      }
    }
  }
  return '{' + parts.join(', ') + '}';
}

// Fetch WhatsApp Web data
async function getWhatsAppWebData() {
  const dbName = 'model-storage';
  let db;
  try {
    db = await openDB(dbName);
  } catch (e) {
    console.error("[WA Extractor] Failed to open IndexedDB model-storage:", e);
    throw new Error("Could not open WhatsApp Web IndexedDB. Please make sure you are logged in.");
  }

  try {
    const contacts = await readAllFromStore(db, 'contact');
    const groups = await readAllFromStore(db, 'group-metadata');
    const participantStore = await readAllFromStore(db, 'participant');
    
    const myJid = getMyJid();
    db.close();

    const resolveJid = (id) => {
      if (!id) return '';
      if (typeof id === 'string') return id;
      if (typeof id === 'object') {
        return id._serialized || id.id || '';
      }
      return String(id);
    };

    // Construct participant mapping
    // Group participants are stored in 'participant' store with 'groupId' as key
    const groupParticipantsMap = new Map();
    const groupAdminsMap = new Map();
    
    if (participantStore.length > 0) {
      participantStore.forEach(record => {
        const gId = resolveJid(record.groupId || record.id);
        if (gId) {
          if (record.participants) {
            groupParticipantsMap.set(gId, record.participants);
          }
          // Collect admins list
          const admins = new Set();
          if (record.admins) record.admins.forEach(a => admins.add(resolveJid(a)));
          if (record.superAdmins) record.superAdmins.forEach(a => admins.add(resolveJid(a)));
          groupAdminsMap.set(gId, admins);
        }
      });
    }

    return {
      myJid,
      contacts: contacts.map(c => {
        const contactJid = resolveJid(c.id);
        const phoneJid = resolveJid(c.phoneNumber || c.id);
        return {
          id: contactJid,
          phoneId: phoneJid,
          name: c.name || '',
          pushname: c.pushname || '',
          isContact: c.isContact === true || c.isMyContact === true || c.isAddressBookContact === 1,
          isMe: c.isMe === true || contactJid === myJid || phoneJid === myJid
        };
      }),
      groups: groups.map(g => {
        const groupJid = resolveJid(g.id);
        
        // Retrieve participants list from either group-metadata or participant store
        let rawParticipants = g.participants || g.participantIds || groupParticipantsMap.get(groupJid) || [];
        
        // If it's an object instead of array
        if (rawParticipants && typeof rawParticipants === 'object' && !Array.isArray(rawParticipants)) {
          rawParticipants = Object.values(rawParticipants);
        }

        const adminsSet = groupAdminsMap.get(groupJid) || new Set();

        const mappedParticipants = (rawParticipants || []).map(p => {
          let pJid = '';
          let isAdmin = false;
          
          if (p) {
            if (typeof p === 'string') {
              pJid = p;
              isAdmin = adminsSet.has(p);
            } else if (typeof p === 'object') {
              pJid = resolveJid(p.id || p.jid || p.user);
              isAdmin = p.isAdmin === true || p.isSuperAdmin === true || p.type === 'admin' || adminsSet.has(pJid);
            }
          }
          
          return { id: pJid, isAdmin };
        }).filter(p => p.id);

        return {
          id: groupJid,
          subject: g.subject || 'Unnamed Group',
          participants: mappedParticipants
        };
      })
    };
  } catch (e) {
    if (db) db.close();
    console.error("[WA Extractor] Error processing stores:", e);
    throw e;
  }
}

// Event listener for communications from Isolated Content Script
window.addEventListener('WA_EXTRACT_REQUEST', async (event) => {
  const { action } = event.detail || {};
  if (action === 'getData') {
    try {
      const data = await getWhatsAppWebData();
      window.dispatchEvent(new CustomEvent('WA_EXTRACT_RESPONSE', {
        detail: { success: true, data }
      }));
    } catch (error) {
      window.dispatchEvent(new CustomEvent('WA_EXTRACT_RESPONSE', {
        detail: { success: false, error: error.message }
      }));
    }
  }
});
