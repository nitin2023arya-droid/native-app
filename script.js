/* ---- Storage & Engine (updated with sauda logic) ---- */
const Storage = {
    KEY: 'bullion_pro_v3',
    get() { return JSON.parse(localStorage.getItem(this.KEY) || '[]'); },
    save(data) { localStorage.setItem(this.KEY, JSON.stringify(data)); ui.render(); }
};


const Engine = {
    calculate(cust) {
        let b = { 
            gold: { Premium: 0, Mcx: 0, Weight: 0 }, 
            silver: { Premium: 0, Mcx: 0, Weight: 0 }, 
            cash: 0 
        };
        
        cust.entries.forEach(e => {
            const isPur = e.action === 'Purchase (IN)';
            const isSale = e.action === 'Sale (OUT)';
            const metalKey = (e.metal || 'gold').toLowerCase().startsWith('s') ? 'silver' : 'gold';
            const entryType = e.type || 'Weight Only';
            const weight = parseFloat(e.weight) || 0;
            const fine = parseFloat(e.fine) || 0;
            const amount = parseFloat(e.amount) || 0;
            
            // For Physical entries
            if (e.nature === 'Physical') {
                // Type A: Cash Only
                if (entryType === 'Type A') {
                    // No stock effect, only cash
                    if (isSale) {
                        b.cash += amount; // Cash Credit
                    } else if (isPur) {
                        b.cash -= amount; // Cash Debit
                    }
                }
                // Type B: Weight + Premium
                else if (entryType === 'Weight+Premium') {
                    if (isSale) {
                        b[metalKey].Premium += fine; // Premium Stock Credit
                        b.cash += amount; // Cash Credit
                    } else if (isPur) {
                        b[metalKey].Premium -= fine; // Premium Stock Debit
                        b.cash -= amount; // Cash Debit
                    }
                }
                // Type C: Weight + MCX
                else if (entryType === 'Weight+MCX') {
                    if (isSale) {
                        b[metalKey].Mcx += fine; // MCX Stock Credit
                        b.cash += amount; // Cash Credit
                    } else if (isPur) {
                        b[metalKey].Mcx -= fine; // MCX Stock Debit
                        b.cash -= amount; // Cash Debit
                    }
                }
                // Type D: Weight Only
                else if (entryType === 'Weight Only') {
                    if (isSale) {
                        b[metalKey].Weight += fine; // Stock Credit only
                        // No cash effect for Type D
                    } else if (isPur) {
                        b[metalKey].Weight -= fine; // Stock Debit only
                        // No cash effect for Type D
                    }
                }
            }
            // For Round-off entries
            else if (e.nature === 'Round-off') {
                // Allowed only for B / C / D
                if (entryType === 'Type A') return;

                // Get the stock bucket
                let stockBucket;
                if (entryType === 'Weight+Premium') {
                    stockBucket = b[metalKey].Premium;
                } else if (entryType === 'Weight+MCX') {
                    stockBucket = b[metalKey].Mcx;
                } else {
                    stockBucket = b[metalKey].Weight;
                }

                // If stock is 0, no round-off possible
                if (stockBucket === 0) return;

                // Determine adjustment direction
                let adjustment = 0;
                if (stockBucket > 0) {
                    // Positive stock: round-off reduces stock
                    adjustment = -Math.min(Math.abs(stockBucket), fine);
                } else {
                    // Negative stock: round-off increases stock
                    adjustment = Math.min(Math.abs(stockBucket), fine);
                }

                // Apply adjustment to stock
                if (entryType === 'Weight+Premium') {
                    b[metalKey].Premium += adjustment;
                } else if (entryType === 'Weight+MCX') {
                    b[metalKey].Mcx += adjustment;
                } else {
                    b[metalKey].Weight += adjustment;
                }

                // Cash effect
                const divisor = metalKey === 'silver' ? 1000 : 10;
                const bhav = parseFloat(e.bhav) || 0;
                const cashAdjustment = (Math.abs(adjustment) * bhav) / divisor;
                
                if (stockBucket > 0) {
                    // Stock Dr → Cash Cr
                    b.cash += cashAdjustment;
                } else {
                    // Stock Cr → Cash Dr
                    b.cash -= cashAdjustment;
                }
            }
            // For Sauda entries (Booking)
            else if (e.nature === 'Sauda') {
                
            }
            // For Cash entries
            else if (e.nature === 'Cash') {
                b.cash -= (e.type === 'Cash Received' ? 1 : -1) * amount;
            }
            // For Paid entries (Metal Delivery from Sauda)
            else if (e.nature === 'Paid') {
                const originalSauda = cust.entries.find(x => x.id === e.saudaId);
                if (!originalSauda) return;

                const amount = parseFloat(e.amount) || 0;

                // CASH ONLY — Sauda payment does NOT move stock
                if (originalSauda.action === 'Purchase (IN)') {
                    // Customer pays us
                    b.cash -= amount;     // Cash Debit
                } else {
                    // We pay customer
                    b.cash += amount;     // Cash Credit
                }
                // ❌ NO Premium / MCX / Weight update here
            }
            // For Settle entries (Cash settlement)
            else if (e.nature === 'Settle') {
                const originalSauda = cust.entries.find(x => x.id === e.saudaId);
                if (!originalSauda) return;

                const metalKey = originalSauda.metal.toLowerCase().startsWith('s') ? 'silver' : 'gold';
                const weight = parseFloat(e.weight) || 0;
                if (weight <= 0) return;

                const bookingBhav = parseFloat(originalSauda.bhav) || 0;
                const settleBhav = parseFloat(e.newBhav) || 0;
                if (bookingBhav === settleBhav) return;

                const divisor = metalKey === 'silver' ? 1000 : 10;

                let customerPLPerUnit;
                
                if (originalSauda.action === 'Purchase (IN)') {
                    // Customer originally purchased (we sold)
                    // For settlement: Customer sells back to us at newBhav
                    // Customer profit = settlement rate - booking rate (higher sell price = profit)
                    customerPLPerUnit = settleBhav - bookingBhav;
                } else {
                    // Customer originally sold (we purchased)
                    // For settlement: Customer buys back from us at newBhav
                    // Customer profit = booking rate - settlement rate (lower buy-back price = profit)
                    customerPLPerUnit = bookingBhav - settleBhav;
                }

                const amount = (Math.abs(customerPLPerUnit) * weight) / divisor;

                if (customerPLPerUnit > 0) {
                    // Customer LOSS → We RECEIVE cash
                    b.cash += amount;
                    e.cashEffect = 'Customer Profit → Cash CR';
                } else if (customerPLPerUnit < 0) {
                    // Customer PROFIT → We PAY cash
                    b.cash -= amount;
                    e.cashEffect = 'Customer Loss → Cash DR';
                }
            }
        });
        return b;
    },

    // NEW: Calculate running cash balances after each entry
    calculateRunningBalances(customer) {
        // Sort entries by date (oldest first)
        const sortedEntries = [...customer.entries].sort((a, b) => {
            // Parse dates for sorting (assuming format DD/MM/YYYY)
            const parseDate = (dateStr) => {
                const parts = dateStr.split('/');
                return new Date(parts[2], parts[1] - 1, parts[0]);
            };
            return parseDate(a.date) - parseDate(b.date);
        });
        
        const balances = [];
        let currentBalance = {
            gold: { Premium: 0, Mcx: 0, Weight: 0 },
            silver: { Premium: 0, Mcx: 0, Weight: 0 },
            cash: 0
        };
        
        sortedEntries.forEach(entry => {
            // Clone current balance
            const newBalance = JSON.parse(JSON.stringify(currentBalance));
            
            // Apply entry to new balance (using the same logic as calculate)
            this.applyEntryToBalance(newBalance, entry, customer.entries);
            
            // Store the cash balance after this entry
            balances.push({
                entryId: entry.id,
                cashAfter: newBalance.cash,
                fullBalance: JSON.parse(JSON.stringify(newBalance))
            });
            
            // Update current balance for next iteration
            currentBalance = newBalance;
        });
        
        return balances;
    },
    
    // Helper: Apply a single entry to a balance object
    applyEntryToBalance(balance, entry, allEntries) {
        const isPur = entry.action === 'Purchase (IN)';
        const isSale = entry.action === 'Sale (OUT)';
        const metalKey = (entry.metal || 'gold').toLowerCase().startsWith('s') ? 'silver' : 'gold';
        const entryType = entry.type || 'Weight Only';
        const weight = parseFloat(entry.weight) || 0;
        const fine = parseFloat(entry.fine) || 0;
        const amount = parseFloat(entry.amount) || 0;
        
        if (entry.nature === 'Physical') {
            if (entryType === 'Type A') {
                if (isSale) balance.cash += amount;
                else if (isPur) balance.cash -= amount;
            }
            else if (entryType === 'Weight+Premium') {
                if (isSale) {
                    balance[metalKey].Premium += fine;
                    balance.cash += amount;
                } else if (isPur) {
                    balance[metalKey].Premium -= fine;
                    balance.cash -= amount;
                }
            }
            else if (entryType === 'Weight+MCX') {
                if (isSale) {
                    balance[metalKey].Mcx += fine;
                    balance.cash += amount;
                } else if (isPur) {
                    balance[metalKey].Mcx -= fine;
                    balance.cash -= amount;
                }
            }
            else if (entryType === 'Weight Only') {
                if (isSale) {
                    balance[metalKey].Weight += fine;
                } else if (isPur) {
                    balance[metalKey].Weight -= fine;
                }
            }
        }
        else if (entry.nature === 'Round-off') {
            if (entryType === 'Type A') return;
            
            let stockBucket;
            if (entryType === 'Weight+Premium') {
                stockBucket = balance[metalKey].Premium;
            } else if (entryType === 'Weight+MCX') {
                stockBucket = balance[metalKey].Mcx;
            } else {
                stockBucket = balance[metalKey].Weight;
            }
            
            if (stockBucket === 0) return;
            
            let adjustment = 0;
            if (stockBucket > 0) {
                adjustment = -Math.min(Math.abs(stockBucket), fine);
            } else {
                adjustment = Math.min(Math.abs(stockBucket), fine);
            }
            
            if (entryType === 'Weight+Premium') {
                balance[metalKey].Premium += adjustment;
            } else if (entryType === 'Weight+MCX') {
                balance[metalKey].Mcx += adjustment;
            } else {
                balance[metalKey].Weight += adjustment;
            }
            
            const divisor = metalKey === 'silver' ? 1000 : 10;
            const bhav = parseFloat(entry.bhav) || 0;
            const cashAdjustment = (Math.abs(adjustment) * bhav) / divisor;
            
            if (stockBucket > 0) {
                balance.cash += cashAdjustment;
            } else {
                balance.cash -= cashAdjustment;
            }
        }
        else if (entry.nature === 'Sauda') {
            // No immediate cash effect for Sauda booking
        }
        else if (entry.nature === 'Cash') {
            balance.cash -= (entry.type === 'Cash Received' ? 1 : -1) * amount;
        }
        else if (entry.nature === 'Paid') {
            const originalSauda = allEntries.find(x => x.id === entry.saudaId);
            if (!originalSauda) return;
            
            const amount = parseFloat(entry.amount) || 0;
            
            if (originalSauda.action === 'Purchase (IN)') {
                balance.cash -= amount;
            } else {
                balance.cash += amount;
            }
        }
        else if (entry.nature === 'Settle') {
            const originalSauda = allEntries.find(x => x.id === entry.saudaId);
            if (!originalSauda) return;
            
            const metalKey = originalSauda.metal.toLowerCase().startsWith('s') ? 'silver' : 'gold';
            const weight = parseFloat(entry.weight) || 0;
            if (weight <= 0) return;
            
            const bookingBhav = parseFloat(originalSauda.bhav) || 0;
            const settleBhav = parseFloat(entry.newBhav) || 0;
            if (bookingBhav === settleBhav) return;
            
            const divisor = metalKey === 'silver' ? 1000 : 10;
            
            let customerPLPerUnit;
            if (originalSauda.action === 'Purchase (IN)') {
                customerPLPerUnit = settleBhav - bookingBhav;
            } else {
                customerPLPerUnit = bookingBhav - settleBhav;
            }
            
            const amount = (Math.abs(customerPLPerUnit) * weight) / divisor;
            
            if (customerPLPerUnit > 0) {
                balance.cash += amount;
            } else if (customerPLPerUnit < 0) {
                balance.cash -= amount;
            }
        }
        
        return balance;
    },
    
    // NEW: Calculate cash balance after a specific entry
    getCashBalanceAfterEntry(customer, entryId) {
        const runningBalances = this.calculateRunningBalances(customer);
        const balanceEntry = runningBalances.find(b => b.entryId === entryId);
        return balanceEntry ? balanceEntry.cashAfter : 0;
    },
    
    // NEW: Get all running balances as a map for quick lookup
    getCashBalanceMap(customer) {
        const runningBalances = this.calculateRunningBalances(customer);
        const balanceMap = {};
        runningBalances.forEach(b => {
            balanceMap[b.entryId] = b.cashAfter;
        });
        return balanceMap;
    }
};

/* ---- UI Layer ---- */
const ui = {
    view: 'dashboard', activeId: null, tab: 'Stock', searchQuery: '',
    ledgerTab: 'All',

    fmtBalHTML(v, digits = 3, unit = '') {
        const num = Math.abs(parseFloat(v) || 0);
        const label = (parseFloat(v) || 0) >= 0 ? 'Cr' : 'Dr';
        const cls = (parseFloat(v) || 0) >= 0 ? 'cr' : 'dr';
        const val = (digits === 0) ? Math.round(num).toLocaleString() : num.toFixed(digits);
        return `<span class="${cls}">${val}${unit ? unit : ''} ${label}</span>`;
    },

    render() {
        const root = document.getElementById('app-root');
        const db = Storage.get();
        const head = document.getElementById('header-actions');
         
      if (this.view === 'dashboard') {
    head.innerHTML = `
        <button class="btn btn-p" onclick="ui.showCustModal()">+</button>
        <button class="btn btn-s" onclick="exportData()">Export</button>
        <button class="btn btn-s" onclick="document.getElementById('import-file').click()">Import</button>
    `;
    this.renderDashboard(root, db);
}   
 
else {
            const c = db.find(x => x.id === this.activeId);
            head.innerHTML = `<button class="btn btn-s" onclick="ui.goToDashboard()">Back</button>`;
            this.renderLedger(root, c);
        }
    },

    renderDashboard(root, db) {
        root.innerHTML = `
            <div class="search-wrapper">
                <div class="search-box-container">
                    <input type="text" id="main-search" class="search-input" placeholder="Search customer..." 
                           value="${this.searchQuery}" oninput="ui.handleSearch(this.value)">
                    ${this.searchQuery ? `<button class="search-clear" onclick="ui.clearSearch()">✕</button>` : ''}
                </div>
            </div>
            <div id="customer-list-container">
                ${this.renderCustomerList(db)}
            </div>`;
    },

    renderCustomerList(db) {
        const filtered = db.filter(c => c.name.toLowerCase().includes(this.searchQuery.toLowerCase()));
        let html = `<h3 style="margin: 10px 0;">Accounts (${filtered.length})</h3>`;
        filtered.forEach(c => {
            const b = Engine.calculate(c);
            const goldTotal = (b.gold.Premium || 0) + (b.gold.Mcx || 0) + (b.gold.Weight || 0);
            const silverTotal = (b.silver.Premium || 0) + (b.silver.Mcx || 0) + (b.silver.Weight || 0);
            html += `
                <div class="card flex j-bet v-center" onclick="ui.openCust('${c.id}')">
                    <div>
                        <strong>${c.name}</strong><br>
                        <small style="color:var(--muted)">Since: ${c.created}</small>
                    </div>
                    <div style="text-align:right; min-width:140px;">
                        <div style="font-size:0.95rem; margin-bottom:4px;">
                            <small style="color:var(--gold)">G: </small> ${this.fmtBalHTML(goldTotal, 3, 'g')}
                        </div>
                        <div style="font-size:0.95rem;">
                            <small style="color:var(--silver)">S: </small> ${this.fmtBalHTML(silverTotal, 3, 'g')}
                        </div>
                        <div style="margin-top:6px;">
                            <small style="color:var(--muted)">Cash:</small> <span class="${b.cash>=0?'cr':'dr'}">₹ ${Math.abs(b.cash).toLocaleString()} ${b.cash>=0?'Cr':'Dr'}</span>
                        </div>
                    </div>
                </div>`;
        });
        return filtered.length ? html : '<p style="text-align:center; color:var(--muted); margin-top:20px;">No matches found</p>';
    },

    handleSearch(val) {
        this.searchQuery = val;
        const db = Storage.get();
        document.getElementById('customer-list-container').innerHTML = this.renderCustomerList(db);
    },

    clearSearch() {
        this.searchQuery = '';
        this.render();
    },

    goToDashboard() {
        this.view = 'dashboard';
        this.render();
    },

    setLedgerTab(tab) {
        this.ledgerTab = tab;
        this.render();
    },

    renderLedger(root, c) {
        const b = Engine.calculate(c);
        const stockLine = (label, val) => `<div class="bal-row"><span>${label}</span><span>${this.fmtBalHTML(val, 3, 'g')}</span></div>`;
        const goldTotal = (b.gold.Premium || 0) + (b.gold.Mcx || 0) + (b.gold.Weight || 0);
        const silverTotal = (b.silver.Premium || 0) + (b.silver.Mcx || 0) + (b.silver.Weight || 0);

        const allEntries = (c.entries || []).slice().reverse();
        
        // Separate entries
        const saudaEntries = allEntries.filter(e => {
            if (e.nature !== 'Sauda') return false;
            const pendingWeight = this.getSaudaPendingWeight(c, e.id);
            return pendingWeight > 0;
        });
        
        const otherEntries = allEntries.filter(e => e.nature !== 'Sauda' || this.getSaudaPendingWeight(c, e.id) <= 0);

        root.innerHTML = `
            <div class="flex j-bet v-center" style="margin-bottom:15px">
                <h2 style="margin:0">${c.name}</h2>
                <div class="flex gap-1">
    <button class="btn btn-s" onclick="ui.openPdfModal('${c.id}')">PDF</button>
    <button class="btn btn-s" onclick="ui.renameCust('${c.id}')"><svg
  width="18"
  height="18"
  viewBox="0 0 22 22"  
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <!-- Pencil body -->
  <path
    d="M3 17.25V21h3.75L17.8 9.95l-3.75-3.75L3 17.25z"
    fill="none"
    stroke="white"
    stroke-width="1.5"
    stroke-linejoin="round"
  />

  <!-- Pencil tip --> 
  <path
    d="M14.05 6.2l3.75 3.75"
    stroke="white"
    stroke-width="1.5"
    stroke-linecap="round"
  />
</svg></button>
    <button class="btn btn-dr" onclick="ui.deleteCust('${c.id}')"><svg
  width="18"
  height="18" 
  viewBox="0 0 22 22" 
  xmlns="http://www.w3.org/2000/svg"
  aria-hidden="true"
>
  <!-- Trash bin body -->
  <rect
    x="7"
    y="8"
    width="10"
    height="12"
    rx="1.5"
    fill="none"
    stroke="white"
    stroke-width="1.6"
  />

  <!-- Lid -->
  <path
    d="M5 7h14"
    stroke="white"
    stroke-width="1.6"
    stroke-linecap="round"
  />
  <path
    d="M9 5h6"
    stroke="white"
    stroke-width="1.6"
    stroke-linecap="round"
  />

  <!-- Inner lines -->
  <line x1="10" y1="10" x2="10" y2="18" stroke="white" stroke-width="1.4"/>
  <line x1="12" y1="10" x2="12" y2="18" stroke="white" stroke-width="1.4"/>
  <line x1="14" y1="10" x2="14" y2="18" stroke="white" stroke-width="1.4"/>
</svg></button>
</div>
            </div>

            <div class="bal-container">
                <div class="bal-header" style="color:var(--gold)">Gold Balances</div>
                ${stockLine('Premium', b.gold.Premium)}
                ${stockLine('Mcx', b.gold.Mcx)}
                ${stockLine('Weight', b.gold.Weight)}
                <div class="bal-row bal-total"><span>Total</span><span>${this.fmtBalHTML(goldTotal,3,'g')}</span></div>
            </div>

            <div class="bal-container">
                <div class="bal-header" style="color:var(--silver)">Silver Balances</div>
                ${stockLine('Premium', b.silver.Premium)}
                ${stockLine('Mcx', b.silver.Mcx)}
                ${stockLine('Weight', b.silver.Weight)}
                <div class="bal-row bal-total"><span>Total</span><span>${this.fmtBalHTML(silverTotal,3,'g')}</span></div>
            </div>

            <div class="card" style="text-align:center; border: 1px solid var(--accent)">
                <label>Cash Balance</label>
                <div style="font-size:1.5rem; font-weight:bold" class="${b.cash>=0?'cr':'dr'}">
                    ₹ ${Math.abs(b.cash).toLocaleString()} ${b.cash >= 0 ? 'Cr' : 'Dr'}
                </div>
            </div>

            <div class="flex gap-1" style="margin-bottom:15px">
                <button class="btn btn-p" style="flex:1" onclick="ui.showStockEntryModal()">+ Stock Entry</button>
                <button class="btn btn-p" style="flex:1" onclick="ui.showEntryModal('Cash')">+ Cash Entry</button>
            </div>

            <div class="ledger-tab-nav" style="display:flex; background:rgba(0,0,0,0.05); padding:4px; border-radius:8px; margin-bottom:15px;">
                <button class="btn" style="flex:1; background:${this.ledgerTab==='Pending'?'white':'transparent'}; color:${this.ledgerTab==='Pending'?'var(--accent)':'#666'}; border:0;" onclick="ui.setLedgerTab('Pending')">Sauda Pending (${saudaEntries.length})</button>
                <button class="btn" style="flex:1; background:${this.ledgerTab==='All'?'white':'transparent'}; color:${this.ledgerTab==='All'?'var(--accent)':'#666'}; border:0;" onclick="ui.setLedgerTab('All')">All Entries (${otherEntries.length})</button>
            </div>

            <div id="ledger-content">
                ${this.ledgerTab === 'Pending' ? this.renderList(saudaEntries, c) : this.renderList(otherEntries, c)}
            </div>
        `;
    },

    getSaudaPendingWeight(customer, saudaId) {
        const sauda = customer.entries.find(x => x.id === saudaId);
        if (!sauda) return 0;

        // ✅ STEP 1: CHECK FINAL CLOSE FLAG
        const hasFinalPaid = customer.entries.some(entry =>
            entry.nature === 'Paid' &&
            entry.saudaId === saudaId &&
            entry.finalClose === true
        );

        // If any Paid entry is marked Final → Sauda fully settled
        if (hasFinalPaid) return 0;

        // ✅ STEP 2: NORMAL PENDING CALCULATION
        let totalPaidWeight = 0;
        let totalSettledWeight = 0;

        customer.entries.forEach(entry => {
            if (entry.saudaId === saudaId) {
                if (entry.nature === 'Paid') {
                    totalPaidWeight += parseFloat(entry.weight) || 0;
                } else if (entry.nature === 'Settle') {
                    totalSettledWeight += parseFloat(entry.weight) || 0;
                }
            }
        });

        const bookingWeight = parseFloat(sauda.weight) || 0;

        return bookingWeight - totalPaidWeight - totalSettledWeight;
    },

   renderList(entries, customer) {
    if (!entries.length) return `<p style="text-align:center; color:var(--muted); padding:20px;">No entries found in this section.</p>`;
    
    // Get cash balance map for all entries
    const cashBalanceMap = Engine.getCashBalanceMap(customer);
    
    return entries.map(e => {
        const cashAfter = cashBalanceMap[e.id] || 0;
        const cashDisplay = this.fmtBalHTML(cashAfter, 0, '');
        
        if (e.nature === 'Sauda') {
            const pendingWeight = this.getSaudaPendingWeight(customer, e.id);
            
            return `
            <div class="card">
                <div class="flex j-bet"><small>${e.date}</small> <strong> ${e.action || ''}</strong></div>
                <div class="flex j-bet">
                    <span>${e.weight ? e.weight+'g ' + (e.metal || '') : (e.type || 'Entry')}</span>
                    <span>Booking Bhav: ${e.bhav || 0}</span>
                </div>
                
                <div style="background:rgba(0,0,0,0.05); padding:8px; border-radius:4px; margin-top:8px;">
                    <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
                        <span>Booking Weight:</span>
                        <span>${e.weight || 0}g</span>
                    </div>
                    <div style="display:flex; justify-content:space-between; font-size:0.9rem;">
                        <span>Pending Weight:</span>
                        <span style="color:var(--accent)">${pendingWeight.toFixed(3)}g</span>
                    </div>
                </div>
              
                ${pendingWeight > 0 ? `
               <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showPaidModal('${e.id}')">
        Paid
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showSettleModal('${e.id}')">
        Settle
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('${e.nature}', '${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        <svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24"
     width="16"
     height="16"
     fill="none"
     stroke="currentColor"
     stroke-width="2"
     stroke-linecap="round"
     stroke-linejoin="round">

  <!-- outer -->
  <rect x="3" y="4" width="18" height="18" rx="2"/>

  <!-- top bar -->
  <line x1="3" y1="10" x2="21" y2="10"/>

  <!-- rings -->
  <line x1="8" y1="2" x2="8" y2="6"/>
  <line x1="16" y1="2" x2="16" y2="6"/>

  <!-- date dots -->
  <circle cx="8" cy="14" r="1"/>
  <circle cx="12" cy="14" r="1"/>
  <circle cx="16" cy="14" r="1"/>

  <circle cx="8" cy="18" r="1"/>
  <circle cx="12" cy="18" r="1"/>
</svg>
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        <svg xmlns="http://www.w3.org/2000/svg"
     viewBox="0 0 24 24"
     width="16"
     height="16"
     fill="none"
     stroke="currentColor"
     stroke-width="2"
     stroke-linecap="round"
     stroke-linejoin="round">

  <polyline points="3 6 5 6 21 6"/>
  <path d="M19 6l-1 14H6L5 6"/>
  <path d="M10 11v6"/>
  <path d="M14 11v6"/>
  <path d="M9 6V4h6v2"/>
</svg>
    </button>
</div>
                ` : `
                <div style="text-align:center; color:var(--success); margin-top:10px; padding:8px; background:rgba(0,200,0,0.1); border-radius:4px;">
                    Fully Settled
                </div>
                `}
            </div>`;
        } else {

    /* =========================
       PHYSICAL
    ========================= */
    if (e.nature === 'Physical') {
        return `
        <div class="card">
            <div class="flex j-bet">
                <small>${e.date}</small>
                <strong>Physical ${e.type ? `(${e.type})` : ''}</strong>
            </div>

            <div class="flex j-bet">
                <span>${e.weight ? e.weight + 'g ' + (e.metal || '') : 'Entry'}</span>
              <span class="${
    (
        e.nature === 'Cash' && e.type === 'Cash Received'
    ) || (
        e.nature === 'Physical' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Paid' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
    )
        ? 'dr'
        : 'cr'
}">
    ₹ ${Math.abs(e.amount || 0).toLocaleString()}
    ${
        (
            e.nature === 'Cash' && e.type === 'Cash Received'
        ) || (
            e.nature === 'Physical' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Paid' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
        )
            ? 'Dr'
            : 'Cr'
    }
</span>
            </div>

            <div style="color:var(--muted); font-size:0.85rem; margin-top:8px; line-height:1.5;">
                <div class="flex j-bet">
                    <span>${e.action || ''}</span>
                    <span>Bhav: ${e.bhav || 0}</span>
                </div>
                <div class="flex j-bet" style="margin-top:2px;">
                    <span>${e.purity ? `Purity: ${e.purity}%` : ''}</span>
                    <span>Fine: ${e.fine || 0}g</span>
                </div>
            </div>
            
            <!-- CASH BALANCE DISPLAY -->
            <div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Cash Balance after entry:</span>
                    <span>${cashDisplay}</span>
                </div>
            </div>

            <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('Physical','${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        Date
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        Delete
    </button>
</div>
        </div>`;
    }

    /* =========================
       ROUND-OFF
    ========================= */
    if (e.nature === 'Round-off') {
        return `
        <div class="card">
            <div class="flex j-bet">
                <small>${e.date}</small>
                <strong>Round-off ${e.type ? `(${e.type})` : ''}</strong>
            </div>

            <div class="flex j-bet">
                <span>${e.weight ? e.weight + 'g ' + (e.metal || '') : 'Adjustment'}</span>
    ${(() => {
    const currentCash = cashAfter;
    const prevEntryIndex = entries.findIndex(x => x.id === e.id);
    const prevEntry = entries[prevEntryIndex + 1];
    const prevCash = prevEntry ? (cashBalanceMap[prevEntry.id] || 0) : 0;

    const isDr = currentCash < prevCash;

    return `
        <span class="${isDr ? 'dr' : 'cr'}">
            ₹ ${Math.abs(e.amount || 0).toLocaleString()} 
            ${isDr ? 'Dr' : 'Cr'}
        </span>
    `;
})()}


            </div>

            <div style="color:var(--muted); font-size:0.85rem; margin-top:8px; line-height:1.5;">
                <div class="flex j-bet">
                    <span>Round-off Adjustment</span>
                    <span>Bhav: ${e.bhav || 0}</span>
                </div>
                <div class="flex j-bet" style="margin-top:2px;">
                    <span>${e.purity ? `Purity: ${e.purity}%` : ''}</span>
                    <span>Fine: ${e.fine || 0}g</span>
                </div>
            </div>
            
            <!-- CASH BALANCE DISPLAY -->
            <div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Cash Balance after entry:</span>
                    <span>${cashDisplay}</span>
                </div>
            </div>

         <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('Round-off','${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        Date
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        Delete
    </button>
</div>
        </div>`;
    }

    /* =========================
       PAID (METAL DELIVERY)
    ========================= */
    if (e.nature === 'Paid') {
        return `
        <div class="card">
            <div class="flex j-bet">
                <small>${e.date}</small>
                <strong>Paid (Metal Delivery)</strong>
            </div>

            <div class="flex j-bet">
                <span>${e.weight ? e.weight + 'g ' + (e.metal || '') : 'Delivery'}</span>
              <span class="${
    (
        e.nature === 'Cash' && e.type === 'Cash Received'
    ) || (
        e.nature === 'Physical' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Paid' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
    )
        ? 'dr'
        : 'cr'
}">
    ₹ ${Math.abs(e.amount || 0).toLocaleString()}
    ${
        (
            e.nature === 'Cash' && e.type === 'Cash Received'
        ) || (
            e.nature === 'Physical' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Paid' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
        )
            ? 'Dr'
            : 'Cr'
    }
</span>
            </div>

             <div style="color:var(--muted); font-size:0.85rem; margin-top:8px; line-height:1.5;">
                <div class="flex j-bet">
                    <span>Booking Metal Delivery</span>
                    <span>Bhav: ${e.bhav || 0}</span>
                </div>
             <div class="flex j-bet" style="margin-top:2px;">
                    <span>
                  ${e.purity !== undefined ? `Purity: ${e.purity}%` : ''}
    </span>
                    <span>Fine: ${e.fine || 0}g</span>
                </div>
                </div>
            
            <!-- CASH BALANCE DISPLAY -->
            <div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Cash Balance after entry:</span>
                    <span>${cashDisplay}</span>
                </div>
            </div>

          <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('Paid','${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        Date
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        Delete
    </button>
</div>
        </div>`;
    }

    /* =========================
       SETTLEMENT
    ========================= */
    if (e.nature === 'Settle') {
        return `
        <div class="card">
            <div class="flex j-bet">
                <small>${e.date}</small>
                <strong>Cash Settlement</strong>
            </div>

            <div class="flex j-bet">
                <span>${e.weight ? e.weight + 'g ' + (e.metal || '') : 'Settlement'}</span>
               <span class="${
    (
        e.nature === 'Cash' && e.type === 'Cash Received'
    ) || (
        e.nature === 'Physical' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Paid' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
    )
        ? 'dr'
        : 'cr'
}">
    ₹ ${Math.abs(e.amount || 0).toLocaleString()}
    ${
        (
            e.nature === 'Cash' && e.type === 'Cash Received'
        ) || (
            e.nature === 'Physical' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Paid' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
        )
            ? 'Dr'
            : 'Cr'
    }
</span>
            </div>

           
 ${(() => {
    const originalSauda = customer.entries.find(x => x.id === e.saudaId);

    const bookingAction = originalSauda?.action || '';

    const settlementAction =
        bookingAction === 'Purchase (IN)'
            ? 'Sale (OUT)'
            : bookingAction === 'Sale (OUT)'
            ? 'Purchase (IN)'
            : '';

    return `
    <div style="color:var(--muted); font-size:0.85rem; margin-top:8px; line-height:1.5;">
        <div class="flex j-bet">
            <span>Booking: ${bookingAction}</span>
            <span>Booking Bhav: ${e.bookingBhav || 0}</span>
        </div>
        <div class="flex j-bet" style="margin-top:2px;">
            <span>Action: ${settlementAction}</span>
            <span>New Bhav: ${e.newBhav || 0}</span>
        </div>
    </div>
    `;
})()}
            
            
            
            <!-- CASH BALANCE DISPLAY -->
            <div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Cash Balance after entry:</span>
                    <span>${cashDisplay}</span>
                </div>
            </div>

          <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('Settle','${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        Date
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        Delete
    </button>
</div>
        </div>`;
    }

    /* =========================
       CASH ENTRIES
    ========================= */
    if (e.nature === 'Cash') {
        return `
        <div class="card">
            <div class="flex j-bet">
                <small>${e.date}</small>
                <strong>Cash Entry</strong>
            </div>

            <div class="flex j-bet">
                <span>${e.type || ''}</span>
             <span class="${
    (
        e.nature === 'Cash' && e.type === 'Cash Received'
    ) || (
        e.nature === 'Physical' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Paid' && e.action === 'Purchase (IN)'
    ) || (
        e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
    )
        ? 'dr'
        : 'cr'
}">
    ₹ ${Math.abs(e.amount || 0).toLocaleString()}
    ${
        (
            e.nature === 'Cash' && e.type === 'Cash Received'
        ) || (
            e.nature === 'Physical' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Paid' && e.action === 'Purchase (IN)'
        ) || (
            e.nature === 'Settle' && (e.cashEffect || '').includes('DR')
        )
            ? 'Dr'
            : 'Cr'
    }
</span>
            </div>

            <div style="color:var(--muted); font-size:0.85rem; margin-top:8px;">
                <div>${e.note || ''}</div>
            </div>
            
            <!-- CASH BALANCE DISPLAY -->
            <div style="margin-top:8px; padding:6px; background:rgba(0,0,0,0.05); border-radius:4px; font-size:0.85rem;">
                <div style="display:flex; justify-content:space-between;">
                    <span>Cash Balance after entry:</span>
                    <span>${cashDisplay}</span>
                </div>
            </div>

          <div class="flex gap-1" style="margin-top:10px">
    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showEntryModal('Cash','${e.id}')">
        Edit
    </button>

    <button class="btn btn-s"
        style="flex:1; font-size:0.7rem"
        onclick="ui.showDateEditModal('${e.id}')">
        Date
    </button>

    <button class="btn btn-dr"
        style="flex:1; font-size:0.7rem"
        onclick="ui.deleteEntry('${e.id}')">
        Delete
    </button>
</div>
        </div>`;
    }

}
    }).join('');
},

    showEntryModal(nature, eid = null) {
        // Route different entry types to their specific forms
        if (nature === 'Physical' || nature === 'Sauda' || nature === 'Round-off') {
            this.showStockEntryModal(eid);
        } else if (nature === 'Cash') {
            this.showCashEntryModal(eid);
        } else if (nature === 'Paid') {
            this.showPaidEditModal(eid);
        } else if (nature === 'Settle') {
            this.showSettleEditModal(eid);
        } else {
            this.showStockEntryModal(eid); // Default to stock form for other types
        }
    },

    // Cash Entry Form (separate from stock form)
    showCashEntryModal(eid = null) {
        const db = Storage.get(); 
        const c = db.find(x => x.id === this.activeId);
        const e = eid ? c.entries.find(x => x.id === eid) : null;
        
        const m = document.getElementById('modal-container'); 
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="modal">
                <h3>${eid ? 'EDIT CASH ENTRY' : 'NEW CASH ENTRY'}</h3>
                <label>Type</label>
                <select id="e-type">
                    <option value="Cash Received" ${e?.type==='Cash Received'?'selected':''}>Customer Received - Dr</option>
                    <option value="Cash Paid" ${e?.type==='Cash Paid'?'selected':''}>Customer Paid - Cr</option>
                </select>
                <label>Amount</label>
                <input type="number" id="e-amount" value="${e?.amount||''}" placeholder="0">
                <label>Note</label>
                <input type="text" id="e-note" value="${e?.note||''}" placeholder="Optional note">
                <div class="flex gap-1" style="margin-top:15px">
                    <button class="btn btn-reset" onclick="ui.resetForm()">Reset</button>
                    <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                    <button class="btn btn-p" onclick="ui.saveCashEntry('${eid||''}')" style="flex:1">${eid ? 'Update' : 'Save'}</button>
                </div>
            </div>
        `;
    },

    // Paid Entry Edit Form
    showPaidEditModal(paidId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const paidEntry = c.entries.find(x => x.id === paidId);
        if (!paidEntry) return;
        
        const sauda = c.entries.find(x => x.id === paidEntry.saudaId);
        if (!sauda) return;
        
        const m = document.getElementById('modal-container');
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <h3>Edit Metal Delivery (Paid)</h3>
                <div class="info-box">
                    <div><strong>Original Sauda:</strong> ${sauda.weight}g ${sauda.metal}</div>
                    <div><strong>Booking Bhav:</strong> ${sauda.bhav}</div>
                    <div><strong>Action:</strong> ${sauda.action}</div>
                </div>
                <label>Weight Delivered (g)</label>
                <input type="number" step="0.001" id="paid-weight" value="${paidEntry.weight || 0}" placeholder="0.000">
                <label>Fine Weight (g)</label>
                <input type="number" step="0.001" id="paid-fine" value="${paidEntry.fine || 0}" placeholder="0.000">
                <label>Purity (%)</label>
                <input type="number" step="0.01" id="paid-purity" value="${paidEntry.purity || (sauda.metal === 'silver' ? 99.90 : 99.50)}">
                <label>M-Type</label>
                <select id="paid-mtype">
                    <option value="Pure" ${paidEntry.mtype === 'Pure' ? 'selected' : ''}>Pure</option>
                    <option value="Impure" ${paidEntry.mtype === 'Impure' ? 'selected' : ''}>Impure</option>
                </select>
                <label>Delivery Status</label>
                <select id="paid-final">
                    <option value="normal" ${!paidEntry.finalClose ? 'selected' : ''}>Normal</option>
                    <option value="final" ${paidEntry.finalClose ? 'selected' : ''}>Final (Close Sauda)</option>
                </select>
                <div class="calc-box">
                    <div><strong>Amount:</strong> <span id="disp-paid-amt">₹ ${paidEntry.amount || 0}</span></div>
                    <div><strong>Cash Effect:</strong> <span style="color:var(--accent)">${sauda.action === 'Purchase (IN)' ? 'Cash Debit' : 'Cash Credit'}</span></div>
                </div>
                <div class="flex gap-1">
                    <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                    <button class="btn btn-p" onclick="ui.updatePaidEntry('${paidId}')" style="flex:1">Update Entry</button>
                </div>
            </div>
        `;
    },

    // Settle Entry Edit Form
    showSettleEditModal(settleId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const settleEntry = c.entries.find(x => x.id === settleId);
        if (!settleEntry) return;
        
        const sauda = c.entries.find(x => x.id === settleEntry.saudaId);
        if (!sauda) return;
        
        const m = document.getElementById('modal-container');
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <h3>Edit Cash Settlement</h3>
                <div class="info-box">
                    <div><strong>Original Sauda:</strong> ${sauda.weight}g ${sauda.metal}</div>
                    <div><strong>Booking Bhav:</strong> ${sauda.bhav}</div>
                    <div><strong>Action:</strong> ${sauda.action}</div>
                </div>
                <label>Weight Settled (g)</label>
                <input type="number" step="0.001" id="settle-weight" value="${settleEntry.weight || 0}" placeholder="0.000">
                <label>New Bhav</label>
                <input type="number" id="new-bhav" value="${settleEntry.newBhav || 0}" placeholder="Settlement rate">
                <div class="calc-box">
                    <div><strong>Booking Bhav:</strong> ${settleEntry.bookingBhav || 0}</div>
                    <div><strong>Settlement Amount:</strong> ₹ ${settleEntry.amount || 0}</div>
                    <div><strong>Cash Effect:</strong> <span style="color:var(--accent)">${settleEntry.cashEffect || ''}</span></div>
                </div>
                <div class="flex gap-1">
                    <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                    <button class="btn btn-p" onclick="ui.updateSettleEntry('${settleId}')" style="flex:1">Update Entry</button>
                </div>
            </div>
        `;
    },

    showPaidModal(saudaId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const sauda = c.entries.find(x => x.id === saudaId);
        if (!sauda) return;
        
        // Calculate pending weight
        const pendingWeight = this.getSaudaPendingWeight(c, saudaId);
        
        const m = document.getElementById('modal-container');
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <h3>Metal Delivery (Paid)</h3>
                <div class="info-box">
                    <div><strong>Booking Weight:</strong> ${sauda.weight}g</div>
                    <div><strong>Pending Weight:</strong> ${pendingWeight.toFixed(3)}g</div>
                    <div><strong>Booking Bhav:</strong> ${sauda.bhav}</div>
                    <div><strong>Metal:</strong> ${sauda.metal}</div>
                    <div><strong>Action:</strong> ${sauda.action}</div>
                </div>
                <label>Weight to Deliver (g) - Max: ${pendingWeight.toFixed(3)}g</label>
                <input type="number" step="0.001" id="paid-weight" value="${pendingWeight}" placeholder="0.000" max="${pendingWeight}">
                <label>Purity (%)</label>
                <input type="number" step="0.01" id="paid-purity" value="${sauda.metal === 'silver' ? 99.90 : 99.50}">
                <label>M-Type</label>
                <select id="paid-mtype">
                    <option value="Pure">Pure</option>
                    <option value="Impure">Impure</option>
                </select>
                <label>Delivery Mode</label>
                <select id="paid-final">
                    <option value="normal">Normal</option>
                    <option value="final">Final (Close Sauda)</option>
                </select>
                <div class="calc-box">
                    <div><strong>Fine Weight:</strong> <span id="disp-paid-fine">0g</span></div>
                    <div><strong>Amount:</strong> <span id="disp-paid-amt">₹ 0</span></div>
                    <div><strong>Cash Effect:</strong> <span id="disp-paid-cash" style="color:var(--accent)"></span></div>
                </div>
                <div class="flex gap-1">
                    <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                    <button class="btn btn-p" onclick="ui.savePaid('${saudaId}')" style="flex:1">Save Paid Entry</button>
                </div>
            </div>
        `;
        
        // Add calculation listeners
        const calculatePaid = () => {
            const weight = parseFloat(document.getElementById('paid-weight').value) || 0;
            const purity = parseFloat(document.getElementById('paid-purity').value) || 0;
            const mtype = document.getElementById('paid-mtype').value;
            const metal = sauda.metal;
            const bhav = sauda.bhav;
            const action = sauda.action;
            
            let fine = 0;
            if (mtype === 'Pure') {
                const standardPurity = metal === 'silver' ? 99.90 : 99.50;
                const deduction = (standardPurity - purity) * (weight / 100);
                fine = weight - deduction;
            } else {
                fine = (weight * purity) / 100;
            }
            fine = Number(fine.toFixed(3));
            const divisor = metal === 'silver' ? 1000 : 10;
            const amount = (fine * bhav) / divisor;
            
            document.getElementById('disp-paid-fine').innerText = fine.toFixed(3) + 'g';
            document.getElementById('disp-paid-amt').innerText = '₹ ' + Math.round(amount).toLocaleString();
            
            // Show cash effect
            if (action === 'Purchase (IN)') {
                // Customer purchased from us, we deliver metal and receive cash
                document.getElementById('disp-paid-cash').innerText = `Cash Debit: ₹ ${Math.round(amount).toLocaleString()}`;
            } else {
                // Customer sold to us, we receive metal and pay cash
                document.getElementById('disp-paid-cash').innerText = `Cash Credit: ₹ ${Math.round(amount).toLocaleString()}`;
            }
        };
        
        document.getElementById('paid-weight').oninput = calculatePaid;
        document.getElementById('paid-purity').oninput = calculatePaid;
        document.getElementById('paid-mtype').onchange = calculatePaid;
        
        calculatePaid();
    },

    showSettleModal(saudaId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const sauda = c.entries.find(x => x.id === saudaId);
        if (!sauda) return;
        
        // Calculate pending weight
        const pendingWeight = this.getSaudaPendingWeight(c, saudaId);
        
        const m = document.getElementById('modal-container');
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="modal" style="max-width: 400px;">
                <h3>Cash Settlement</h3>
                <div class="info-box">
                    <div><strong>Booking Weight:</strong> ${sauda.weight}g</div>
                    <div><strong>Pending Weight:</strong> ${pendingWeight.toFixed(3)}g</div>
                    <div><strong>Booking Bhav:</strong> ${sauda.bhav}</div>
                    <div><strong>Metal:</strong> ${sauda.metal}</div>
                    <div><strong>Transaction:</strong> ${sauda.action}</div>
                </div>
                <label>Weight to Settle (g) - Max: ${pendingWeight.toFixed(3)}g</label>
                <input type="number" step="0.001" id="settle-weight" value="${pendingWeight}" placeholder="0.000" max="${pendingWeight}">
                <label>New Bhav</label>
                <input type="number" id="new-bhav" value="${sauda.bhav}" placeholder="Enter new bhav">
                <div class="calc-box" style="margin-top: 15px;">
                    <div><strong>Weight Settling:</strong> <span id="disp-settle-weight">${pendingWeight}g</span></div>
                    <div><strong>Difference:</strong> <span id="disp-diff">0</span></div>
                    <div><strong>Settlement Amount:</strong> <span id="disp-settle-amt">₹ 0</span></div>
                    <div><strong>Cash Effect:</strong> <span id="disp-effect" style="color: var(--accent)"></span></div>
                </div>
                <div class="flex gap-1">
                    <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                    <button class="btn btn-p" onclick="ui.saveSettle('${saudaId}')" style="flex:1">Save Settlement</button>
                </div>
            </div>
        `;
        
        // Add calculation listener
        const calculateSettle = () => {
            const settleWeight = parseFloat(document.getElementById('settle-weight').value) || 0;
            const newBhav = parseFloat(document.getElementById('new-bhav').value) || 0;
            const bookingBhav = sauda.bhav || 0;
            const action = sauda.action;
            const metal = sauda.metal;
            
            // Validate weight
            if (settleWeight > pendingWeight) {
                alert(`Cannot settle more than ${pendingWeight.toFixed(3)}g`);
                document.getElementById('settle-weight').value = pendingWeight;
                return;
            }
            
            const divisor = metal === 'silver' ? 1000 : 10;
            const difference = newBhav - bookingBhav;
            const amount = (Math.abs(difference) * settleWeight) / divisor;
            
            let effect = '';
            if (action === 'Purchase (IN)') {
                if (difference > 0) {
                    effect = `Profit → Cash CR: ₹ ${Math.round(amount).toLocaleString()}`;
                } else {
                    effect = `Loss → Cash DR: ₹ ${Math.round(amount).toLocaleString()}`;
                }
            } else {
                if (difference > 0) {
                    effect = `Profit → Cash CR: ₹ ${Math.round(amount).toLocaleString()}`;
                } else {
                    effect = `Loss → Cash DR: ₹ ${Math.round(amount).toLocaleString()}`;
                }
            }
            
            document.getElementById('disp-settle-weight').innerText = settleWeight.toFixed(3) + 'g';
            document.getElementById('disp-diff').innerText = difference.toFixed(2);
            document.getElementById('disp-settle-amt').innerText = '₹ ' + Math.round(amount).toLocaleString();
            document.getElementById('disp-effect').innerText = effect;
        };
        
        document.getElementById('settle-weight').oninput = calculateSettle;
        document.getElementById('new-bhav').oninput = calculateSettle;
        calculateSettle();
    },

    savePaid(saudaId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const sauda = c.entries.find(x => x.id === saudaId);
        if (!sauda) return;
        
        const weight = parseFloat(document.getElementById('paid-weight').value) || 0;
        const purity = parseFloat(document.getElementById('paid-purity').value) || 0;
        const mtype = document.getElementById('paid-mtype').value;
        const isFinal = document.getElementById('paid-final')?.value === 'final';
      
        // Calculate fine weight
        let fine = 0;
        if (mtype === 'Pure') {
            const standardPurity = sauda.metal === 'silver' ? 99.90 : 99.50;
            const deduction = (standardPurity - purity) * (weight / 100);
            fine = weight - deduction;
        } else {
            fine = (weight * purity) / 100;
        }
        fine = Number(fine.toFixed(3));
        const divisor = sauda.metal === 'silver' ? 1000 : 10;
        const amount = (fine * sauda.bhav) / divisor;
        
        // Create Paid entry
      const paidEntry = {
    id: 'paid_' + Date.now(),
    date: new Date().toLocaleDateString('en-GB'),
    nature: 'Paid',
    saudaId: saudaId,
    action: sauda.action,
    metal: sauda.metal,
    weight: weight,
    purity: purity,   // ✅ THIS FIXES YOUR ISSUE
    fine: fine,
    bhav: sauda.bhav,
    amount: Math.round(amount),
    finalClose: isFinal
};
        
        c.entries.push(paidEntry);
        Storage.save(db);
        this.closeModal();
    },

    saveSettle(saudaId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const sauda = c.entries.find(x => x.id === saudaId);
        if (!sauda) return;
        
        const settleWeight = parseFloat(document.getElementById('settle-weight').value) || 0;
        const newBhav = parseFloat(document.getElementById('new-bhav').value) || 0;
        const action = sauda.action;
        const metal = sauda.metal;
        
        const divisor = metal === 'silver' ? 1000 : 10;
        const difference = newBhav - sauda.bhav;
        const amount = (Math.abs(difference) * settleWeight) / divisor;
        
        // Create Settle entry
        const settleEntry = {
            id: 'settle_' + Date.now(),
            date: new Date().toLocaleDateString('en-GB'),
            nature: 'Settle',
            saudaId: saudaId,
            action: action,
            metal: metal,
            weight: settleWeight,
            newBhav: newBhav,
            bookingBhav: sauda.bhav,
            amount: Math.round(amount)
        };
        
        c.entries.push(settleEntry);
        Storage.save(db);
        this.closeModal();
    },

    // Save/Update Cash Entry
    saveCashEntry(eid) {
        const db = Storage.get(); 
        const c = db.find(x => x.id === this.activeId);
        
        const entry = {
            id: eid || 'e' + Date.now(),
            date: eid ? c.entries.find(x => x.id === eid).date : new Date().toLocaleDateString('en-GB'),
            nature: 'Cash',
            type: document.getElementById('e-type').value,
            amount: parseFloat(document.getElementById('e-amount').value || 0),
            note: document.getElementById('e-note').value
        };
        
        if (eid) {
            const idx = c.entries.findIndex(x => x.id === eid);
            if (idx !== -1) c.entries[idx] = entry;
        } else {
            c.entries.push(entry);
        }
        
        Storage.save(db);
        this.closeModal();
    },

   // Update Paid Entry (Ledger-correct)
// Update Paid Entry (Ledger-correct)
updatePaidEntry(paidId) {
    const db = Storage.get();
    const c = db.find(x => x.id === this.activeId);
    if (!c) return;

    const idx = c.entries.findIndex(x => x.id === paidId);
    if (idx === -1) return;

    const paidEntry = c.entries[idx];
    const sauda = c.entries.find(x => x.id === paidEntry.saudaId);
    if (!sauda) return;

    /* -------------------------------
       1. REVERSE OLD CASH EFFECT
    --------------------------------*/
    const oldAmount = paidEntry.amount || 0;

    if (oldAmount > 0) {
        if (paidEntry.action === 'Purchase (IN)') {
            // Earlier: Cash Debit → now reverse
            c.cashBalance += oldAmount;
        } else {
            // Earlier: Cash Credit → now reverse
            c.cashBalance -= oldAmount;
        }
    }

    /* -------------------------------
       2. RECALCULATE NEW VALUES
    --------------------------------*/
    const weight = parseFloat(document.getElementById('paid-weight').value) || 0;
    const purity = parseFloat(document.getElementById('paid-purity').value) || 0;
    const mtype  = document.getElementById('paid-mtype').value;
    const isFinal = document.getElementById('paid-final').value === 'final';

    let fine = 0;
    if (mtype === 'Pure') {
        const standardPurity = sauda.metal === 'silver' ? 99.90 : 99.50;
        const deduction = (standardPurity - purity) * (weight / 100);
        fine = weight - deduction;
    } else {
        fine = (weight * purity) / 100;
    }

    fine = Number(fine.toFixed(3));

    const divisor = sauda.metal === 'silver' ? 1000 : 10;
    const amount = Math.round((fine * sauda.bhav) / divisor);

    /* -------------------------------
       3. APPLY NEW CASH EFFECT
    --------------------------------*/
    if (amount > 0) {
        if (paidEntry.action === 'Purchase (IN)') {
            // New Cash Debit
            c.cashBalance -= amount;
        } else {
            // New Cash Credit
            c.cashBalance += amount;
        }
    }

    /* -------------------------------
       4. UPDATE PAID ENTRY
    --------------------------------*/
    c.entries[idx] = {
        ...paidEntry,
        weight,
        purity,
        mtype,
        fine,
        amount,
        finalClose: isFinal
    };

    Storage.save(db);
    this.closeModal();
},

    // Update Settle Entry
    updateSettleEntry(settleId) {
        const db = Storage.get();
        const c = db.find(x => x.id === this.activeId);
        const settleEntry = c.entries.find(x => x.id === settleId);
        if (!settleEntry) return;
        
        const sauda = c.entries.find(x => x.id === settleEntry.saudaId);
        if (!sauda) return;
        
        const idx = c.entries.findIndex(x => x.id === settleId);
        if (idx === -1) return;
        
        const weight = parseFloat(document.getElementById('settle-weight').value) || 0;
        const newBhav = parseFloat(document.getElementById('new-bhav').value) || 0;
        const bookingBhav = sauda.bhav || 0;
        
        // Recalculate settlement amount
        const divisor = sauda.metal === 'silver' ? 1000 : 10;
        let customerPLPerUnit;
        
        if (sauda.action === 'Purchase (IN)') {
            customerPLPerUnit = newBhav - bookingBhav;
        } else {
            customerPLPerUnit = bookingBhav - newBhav;
        }
        
        const amount = (Math.abs(customerPLPerUnit) * weight) / divisor;
        
        // Update the Settle entry
        c.entries[idx] = {
            ...settleEntry,
            weight: weight,
            newBhav: newBhav,
            amount: amount,
            cashEffect: customerPLPerUnit > 0 ? 'Customer Profit → Cash CR' : 
                       customerPLPerUnit < 0 ? 'Customer Loss → Cash DR' : ''
        };
        
        Storage.save(db);
        this.closeModal();
    },

    showCustModal() {
        const m = document.getElementById('modal-container'); m.classList.remove('hidden');
        m.innerHTML = `
            <div class="modal">
                <h3>New Customer</h3>
                <input type="text" id="c-name" placeholder="Name" autofocus>
                <div class="flex gap-1">
                    <button class="btn btn-reset" onclick="document.getElementById('c-name').value=''">Reset</button>
                    <button class="btn btn-s" onclick="ui.closeModal()">Close</button>
                    <button class="btn btn-p" onclick="ui.saveCust()" style="flex:1">Save</button>
                </div>
            </div>`;
    },

    showStockEntryModal(eid = null) {
        const db = Storage.get(); 
        const c = db.find(x => x.id === this.activeId);
        const e = eid ? c.entries.find(x => x.id === eid) : null;
        
        stockEntry.entries = e ? [{
            nature: e.nature || 'Physical',
            type: e.type || 'Weight Only',
            trans: e.action === 'Purchase (IN)' ? 'Purchase' : 'Sale',
            metal: (e.metal || 'Gold').charAt(0).toUpperCase() + (e.metal||'').slice(1),
            mtype: e.mtype || 'Pure',
            weight: e.weight || '',
            purity: e.purity || 99.50,
            fine: e.fine || 0,
            mcx: e.mcx || '',
            prem: e.prem || '',
            bhav: e.bhav || 0,
            amt: e.amount || 0
        }] : [stockEntry.getEmptyObject()];
        stockEntry.idx = 0;
        
        const m = document.getElementById('modal-container'); 
        m.classList.remove('hidden');
        
        m.innerHTML = `
            <div class="voucher-container" style="width:100%; max-width:500px; max-height:85vh;">
                <div class="flex j-bet v-center" style="padding: 10px; border-bottom: 1px solid var(--border); display:flex; justify-content:space-between; align-items:center;">
                    <strong style="color: var(--gold)">${eid ? 'EDIT STOCK ENTRY' : 'NEW STOCK ENTRY'}</strong>
                    <button class="btn btn-add" onclick="ui.addStockEntry()">NEW ENTRY +</button>
                </div>
                
                <div class="entry-nav" id="tab-list-stock">
                    ${stockEntry.entries.map((entry, i) => `
                        <div class="entry-tab ${i===stockEntry.idx?'active':''}" onclick="stockEntry.switchTab(${i})">
                            Entry ${i+1}
                            <span class="tab-fine">${entry.fine.toFixed(2)}g</span>
                            <span class="tab-amt">₹${Math.round(entry.amt).toLocaleString()}</span>
                        </div>
                    `).join('')}
                </div>
                
                <div style="padding: 12px; overflow-y: auto; flex: 1;" id="form-content-stock">
                    <div id="dynamic-form-fields-stock">
                        ${stockEntry.renderEntryForm(stockEntry.idx)}
                    </div>
                    <div class="entry-actions">
                        <button class="btn btn-entry-reset" onclick="ui.resetStockEntry()">RESET ENTRY</button>
                        <button class="btn btn-entry-close" onclick="ui.deleteStockEntry()">DELETE ENTRY</button>
                    </div>
                </div>
                
                <div class="stock-footer">
                    <div class="total-strip">
                        <div>Total Fine: <span id="grand-fine" style="color:var(--gold); font-size: 14px;">0.000</span></div>
                        <div>Total Amt: <span id="grand-amt" style="color:var(--accent); font-size: 14px;">₹ 0</span></div>
                    </div>
                    <div class="row-2">
                        <button class="btn btn-close-main" onclick="ui.closeModal()">EXIT</button>
                        <button class="btn btn-submit" onclick="ui.saveStockEntry('${eid || ''}')">SAVE ENTRY</button>
                    </div>
                </div>
            </div>
        `;
        
        const tFine = stockEntry.entries.reduce((a, b) => a + (parseFloat(b.fine) || 0), 0);
        const tAmt = stockEntry.entries.reduce((a, b) => a + (parseFloat(b.amt) || 0), 0);
        document.getElementById('grand-fine').innerText = tFine.toFixed(3);
        document.getElementById('grand-amt').innerText = '₹ ' + Math.round(tAmt).toLocaleString();
    },

    addStockEntry() {
        stockEntry.entries.push(stockEntry.getEmptyObject());
        stockEntry.idx = stockEntry.entries.length - 1;
        this.refreshStockForm();
    },

    switchStockTab(i) {
        stockEntry.idx = i;
        this.refreshStockForm();
    },

    resetStockEntry() {
        if(confirm("Reset current entry?")) { 
            stockEntry.entries[stockEntry.idx] = stockEntry.getEmptyObject(); 
            this.refreshStockForm(); 
        }
    },

    deleteStockEntry() {
        if (stockEntry.entries.length === 1) return alert("Must have 1 entry.");
        if(confirm("Delete this entry?")) { 
            stockEntry.entries.splice(stockEntry.idx, 1); 
            stockEntry.idx = 0; 
            this.refreshStockForm(); 
        }
    },

    refreshStockForm() {
        const tabList = document.getElementById('tab-list-stock');
        const formContent = document.getElementById('dynamic-form-fields-stock');
        
        if (tabList) {
            tabList.innerHTML = stockEntry.entries.map((entry, i) => `
                <div class="entry-tab ${i===stockEntry.idx?'active':''}" onclick="ui.switchStockTab(${i})">
                    Entry ${i+1}
                    <span class="tab-fine">${entry.fine.toFixed(2)}g</span>
                    <span class="tab-amt">₹${Math.round(entry.amt).toLocaleString()}</span>
                </div>
            `).join('');
        }
        
        if (formContent) {
            formContent.innerHTML = stockEntry.renderEntryForm(stockEntry.idx);
        }
        
        const tFine = stockEntry.entries.reduce((a, b) => a + (parseFloat(b.fine) || 0), 0);
        const tAmt = stockEntry.entries.reduce((a, b) => a + (parseFloat(b.amt) || 0), 0);
        const grandFineEl = document.getElementById('grand-fine');
        const grandAmtEl = document.getElementById('grand-amt');
        if(grandFineEl) grandFineEl.innerText = tFine.toFixed(3);
        if(grandAmtEl) grandAmtEl.innerText = '₹ ' + Math.round(tAmt).toLocaleString();
    },

  saveStockEntry(eid) {
    const db = Storage.get();
    const c = db.find(x => x.id === this.activeId);

    // ✅ find existing entry ONLY for edit
    const existing = eid
        ? c.entries.find(x => x.id === eid)
        : null;

    const ledgerEntries = stockEntry.entries.map(entry => ({
        id: eid || 'e' + Date.now() + Math.random(),

        // ✅ FIX: preserve date on edit
        date: existing
            ? existing.date
            : new Date().toLocaleDateString('en-GB'),

        nature: entry.nature || 'Physical',
        action: entry.trans === 'Purchase' ? 'Purchase (IN)' : 'Sale (OUT)',
        metal: entry.metal.toLowerCase(),
        type: entry.type,
        weight: parseFloat(entry.weight) || 0,
        amount: Math.round(entry.amt),
        mtype: entry.mtype,
        purity: parseFloat(entry.purity) || 0,
        fine: parseFloat(entry.fine) || 0,
        mcx: parseFloat(entry.mcx) || 0,
        prem: parseFloat(entry.prem) || 0,
        bhav: parseFloat(entry.bhav) || 0
    }));

    if (eid) {
        const idx = c.entries.findIndex(x => x.id === eid);
        if (idx !== -1) c.entries[idx] = ledgerEntries[0];
    } else {
        c.entries.push(...ledgerEntries);
    }

    Storage.save(db);
    this.closeModal();

    },

    saveCust() {
        const n = document.getElementById('c-name').value; if(!n) return;
        const db = Storage.get();
        db.push({ id: 'c'+Date.now(), name: n, created: new Date().toLocaleDateString('en-GB'), entries: [] });
        Storage.save(db); this.closeModal();
    },

    deleteEntry(eid) { 
        if(confirm("Delete entry?")) { 
            const db = Storage.get(); 
            const c = db.find(x => x.id === this.activeId); 
            c.entries = c.entries.filter(x => x.id !== eid); 
            Storage.save(db); 
        } 
    },
    
    renameCust(id) { 
        const n = prompt("New name:"); 
        if(n) { 
            const db = Storage.get(); 
            db.find(x => x.id === id).name = n; 
            Storage.save(db); 
        } 
    },
    
    deleteCust(id) { 
        if(confirm("Delete Customer?")) { 
            Storage.save(Storage.get().filter(x => x.id !== id)); 
            this.view = 'dashboard'; 
            this.render(); 
        } 
    },
    
    openCust(id) { 
        this.activeId = id; 
        this.ledgerTab = 'All'; 
        this.view = 'ledger'; 
        this.render(); 
    },
    
    closeModal() { 
        document.getElementById('modal-container').classList.add('hidden'); 
    },
    
    showDateEditModal(entryId) {
    const db = Storage.get();
    const c = db.find(x => x.id === this.activeId);
    const e = c.entries.find(x => x.id === entryId);
    if (!e) return;

    const m = document.getElementById('modal-container');
    m.classList.remove('hidden');

    m.innerHTML = `
        <div class="modal" style="max-width:320px">
            <h3>Update Entry Date</h3>

            <label>Current Date</label>
            <input type="text" value="${e.date}" disabled>

            <label>New Date</label>
            <input type="date" id="new-entry-date">

            <div class="flex gap-1" style="margin-top:15px">
                <button class="btn btn-s" onclick="ui.closeModal()">Cancel</button>
                <button class="btn btn-p" style="flex:1"
                    onclick="ui.updateEntryDate('${entryId}')">
                    Update Date
                </button>
            </div>
        </div>
    `;
}, 

updateEntryDate(entryId) {
    const newDateInput = document.getElementById('new-entry-date').value;
    if (!newDateInput) {
        alert('Please select a date');
        return;
    }

    const db = Storage.get();
    const c = db.find(x => x.id === this.activeId);
    const e = c.entries.find(x => x.id === entryId);
    if (!e) return;

    // Convert YYYY-MM-DD → DD/MM/YYYY
    const [y, m, d] = newDateInput.split('-');
    const formattedDate = `${d}/${m}/${y}`;

    // 🔒 Only date changes
    e.date = formattedDate;

    Storage.save(db);
    this.closeModal();
}, 

    
fmtLedgerAmtHTML(entryId, amount, customer) {
    const cashMap = Engine.getCashBalanceMap(customer);

    // Cash after this entry
    const cashAfter = cashMap[entryId] || 0;

    // Cash before this entry
    const entries = [...customer.entries]
        .sort((a, b) => {
            const d = s => {
                const [dd, mm, yy] = s.split('/');
                return new Date(yy, mm - 1, dd);
            };
            return d(a.date) - d(b.date);
        });

    let cashBefore = 0;
    for (let e of entries) {
        if (e.id === entryId) break;
        cashBefore = cashMap[e.id] ?? cashBefore;
    }

    const isCr = cashAfter > cashBefore;
    const amt = Math.abs(amount || 0);

    return `
        <span class="${isCr ? 'cr' : 'dr'}">
            ₹ ${amt.toLocaleString()} ${isCr ? 'Cr' : 'Dr'}
        </span>
    `;
},





    
    resetForm() { 
        const ins = document.querySelectorAll('.modal input'); 
        ins.forEach(i => i.value = ''); 
    }
};

// Stock Entry Manager with MCX/Premium enable/disable logic for Physical entries
const stockEntry = {
    entries: [], idx: 0,
    getEmptyObject() {
    return { 
        nature: 'Physical', 
        type: 'Type A',           // ✅ changed from 'Weight Only' to 'Type A'
        trans: 'Purchase', 
        metal: 'Gold', 
        mtype: 'Pure', 
        weight: '', 
        purity: 99.50, 
        fine: 0, 
        mcx: '', 
        prem: '', 
        bhav: 0, 
        amt: 0 
    };
},
    update(key, val, entryIndex) {
        const e = this.entries[entryIndex];

        e[key] = (['weight', 'purity', 'mcx', 'prem'].includes(key)) ? (val || '') : val;

        if (key === 'metal') {
            e.purity = (val === 'Silver') ? 99.90 : 99.50;
            const purityInput = document.querySelector(
                `#dynamic-form-fields-stock input[oninput*="update('purity'"]`
            );
            if (purityInput) purityInput.value = e.purity;
        }

        if (key === 'nature' && val === 'Round-off') {
            if (e.type === 'Type A') {
                e.type = 'Weight Only';
                const typeSelect = document.querySelector(`#dynamic-form-fields-stock select[onchange*="update('type'"]`);
                if (typeSelect) typeSelect.value = 'Weight Only';
            }
        }

        const weight = parseFloat(e.weight) || 0;
        const purity = parseFloat(e.purity) || 0;
        const mcx = parseFloat(e.mcx) || 0;
        const prem = parseFloat(e.prem) || 0;

        const standardPurity = (e.metal === 'Silver') ? 99.90 : 99.50;

      let fine;

if (e.mtype === 'Pure') {
    const deduction = (standardPurity - purity) * (weight / 100);
    fine = weight - deduction;
} else {
    fine = (weight * purity) / 100;
}

// normalize precision once
e.fine = Number(fine.toFixed(3));
        // Bhav calculation
        e.bhav = mcx + prem;

        // Amount calculation
        const divisor = (e.metal === 'Silver') ? 1000 : 10;
        e.amt = (e.fine * e.bhav) / divisor;

        // For Sauda entries, amount should be 0
        if (e.nature === 'Sauda') {
            e.amt = 0;
        }

        this.updateCalculatedUI(entryIndex);

        // ✅ Refresh the form when nature or entry type changes
        // to update the disabled state of MCX and Premium fields
        if (key === 'nature' || key === 'type') {
            ui.refreshStockForm();
        }
    },
    updateCalculatedUI(entryIndex) {
        const e = this.entries[entryIndex];
        const fineEl = document.getElementById('disp-fine-' + entryIndex);
        const bhavEl = document.getElementById('disp-bhav-' + entryIndex);
        const amtEl = document.getElementById('disp-amt-' + entryIndex);
        if(fineEl) fineEl.innerText = e.fine.toFixed(3);
        if(bhavEl) bhavEl.innerText = e.bhav.toLocaleString();
        if(amtEl) amtEl.innerText = '₹ ' + Math.round(e.amt).toLocaleString();
        const activeTab = document.querySelector('.entry-tab.active');
        if(activeTab) {
            const tf = activeTab.querySelector('.tab-fine');
            const ta = activeTab.querySelector('.tab-amt');
            if(tf) tf.innerText = e.fine.toFixed(2) + 'g';
            if(ta) ta.innerText = '₹' + Math.round(e.amt).toLocaleString();
        }
        const tFine = this.entries.reduce((a, b) => a + (parseFloat(b.fine) || 0), 0);
        const tAmt = this.entries.reduce((a, b) => a + (parseFloat(b.amt) || 0), 0);
        const grandFineEl = document.getElementById('grand-fine');
        const grandAmtEl = document.getElementById('grand-amt');
        if(grandFineEl) grandFineEl.innerText = tFine.toFixed(3);
        if(grandAmtEl) grandAmtEl.innerText = '₹ ' + Math.round(tAmt).toLocaleString();
    },
    renderEntryForm(entryIndex) {
        const e = this.entries[entryIndex];
        const isRoundOff = e.nature === 'Round-off';
        const isSauda = e.nature === 'Sauda';
        const isPhysical = e.nature === 'Physical';
        
        // Determine disabled state for MCX and Premium based on Physical + Entry Type
        const mcxDisabled = isPhysical && (e.type === 'Weight+Premium' || e.type === 'Weight Only');
        const premDisabled = isPhysical && (e.type === 'Weight+MCX' || e.type === 'Weight Only');

        let entryTypeOptions = '';
        if (isRoundOff) {
            entryTypeOptions = `
                <option ${e.type==='Weight Only'?'selected':''}>Weight Only</option>
                <option ${e.type==='Weight+Premium'?'selected':''}>Weight+Premium</option>
                <option ${e.type==='Weight+MCX'?'selected':''}>Weight+MCX</option>
            `;
        } else {
            entryTypeOptions = `
                <option ${e.type==='Type A'?'selected':''}>Type A</option>
                <option ${e.type==='Weight+Premium'?'selected':''}>Weight+Premium</option>
                <option ${e.type==='Weight+MCX'?'selected':''}>Weight+MCX</option>
                <option ${e.type==='Weight Only'?'selected':''}>Weight Only</option>
            `;
        }
        
        return `
            <div class="row-2">
                <div class="boxie-group"><label>Nature</label>
                    <select onchange="stockEntry.update('nature',this.value, ${entryIndex})">
                        <option ${e.nature==='Physical'?'selected':''}>Physical</option>
                        <option ${e.nature==='Sauda'?'selected':''}>Sauda</option>
                        <option ${e.nature==='Round-off'?'selected':''} ${e.type==='Type A'?'disabled':''}>Round-off</option>
                    </select>
                </div>
                <div class="boxie-group"><label>Entry Type</label>
                    <select onchange="stockEntry.update('type',this.value, ${entryIndex})" ${isRoundOff ? 'style="border-color: var(--accent)"' : ''}>
                        ${entryTypeOptions}
                    </select>
                </div>
            </div>
            <div class="row-3">
                <div class="boxie-group"><label>Trans.</label>
                    <select onchange="stockEntry.update('trans',this.value, ${entryIndex})">
                        <option ${e.trans==='Purchase'?'selected':''}>Purchase</option>
                        <option ${e.trans==='Sale'?'selected':''}>Sale</option>
                    </select>
                </div>
                <div class="boxie-group"><label>Metal</label>
                    <select onchange="stockEntry.update('metal',this.value, ${entryIndex})">
                        <option ${e.metal==='Gold'?'selected':''}>Gold</option>
                        <option ${e.metal==='Silver'?'selected':''}>Silver</option>
                    </select>
                </div>
                <div class="boxie-group"><label>M-Type</label>
                    <select onchange="stockEntry.update('mtype',this.value, ${entryIndex})">
                        <option ${e.mtype==='Pure'?'selected':''}>Pure</option>
                        <option ${e.mtype==='Impure'?'selected':''}>Impure</option>
                    </select>
                </div>
            </div>
            <div class="row-3">
                <div class="boxie-group"><label>Weight</label>
                    <input type="number" step="0.001" value="${e.weight}" oninput="stockEntry.update('weight',this.value, ${entryIndex})" placeholder="0.000">
                </div>
                <div class="boxie-group"><label>Purity%</label>
                    <input type="number" step="0.01" value="${e.purity}" oninput="stockEntry.update('purity',this.value, ${entryIndex})">
                </div>
                <div class="boxie-group"><label>Fine Wt</label>
                    <div class="calc-val" id="disp-fine-${entryIndex}" style="color:var(--gold)">${e.fine.toFixed(3)}</div>
                </div>
            </div>
            <div class="row-3">
                <div class="boxie-group"><label>MCX Bhav</label>
                    <input type="number" value="${e.mcx}" 
                           oninput="stockEntry.update('mcx',this.value, ${entryIndex})" 
                           placeholder="0"
                           ${mcxDisabled ? 'disabled' : ''}>
                </div>
                <div class="boxie-group"><label>Premium</label>
                    <input type="number" value="${e.prem}" 
                           oninput="stockEntry.update('prem',this.value, ${entryIndex})" 
                           placeholder="0"
                           ${premDisabled ? 'disabled' : ''}>
                </div>
                <div class="boxie-group"><label>Bhav</label>
                    <div class="calc-val" id="disp-bhav-${entryIndex}">${e.bhav.toLocaleString()}</div>
                </div>
            </div>
            <div class="boxie-group">
                <label>Entry Amount</label>
                <div class="calc-val" id="disp-amt-${entryIndex}" style="color:var(--accent); font-size:16px">
                    ₹ ${Math.round(e.amt).toLocaleString()}
                    ${e.type === 'Type A' ? ' (Cash Only)' : 
                      isRoundOff ? ' (Round-off)' : 
                      isSauda ? ' (Booking - No Cash)' : ''}
                </div>
            </div>
        `;
    }
};

stockEntry.switchTab = function(i) {
    stockEntry.idx = i;
    ui.refreshStockForm();
};

ui.render();