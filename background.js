// Array to store tab IDs of active tabs
let activeTabs = [];

// Function to check if a tab is playing audio or video
function isTabPlayingMedia(tabId) {
    return new Promise((resolve, reject) => {
        chrome.tabs.get(tabId, tab => {
            if (chrome.runtime.lastError) {
                console.error(`Error getting tab with ID ${tabId}: ${chrome.runtime.lastError.message}`);
                resolve(false);
                return;
            }
            const isPlaying = tab.audible || (tab.status === 'loading' && tab.url.startsWith('https://www.youtube.com/'));
            console.log(`Tab ID: ${tabId}, Audible: ${tab.audible}, Status: ${tab.status}, URL: ${tab.url}, Is Playing Media: ${isPlaying}`);
            resolve(isPlaying);
        });
    });
}

// Function to check if a tab belongs to a special service (Google Sheets, Google Slides, ChatGPT)
function isSpecialServiceTab(url) {
    return url.includes('docs.google.com/spreadsheets') ||
           url.includes('docs.google.com/presentation') ||
           url.includes('chat.openai.com/chat');
}

// Function to group special service tabs
function groupSpecialServiceTabs(tabs) {
    const groupedTabs = {};
    for (const tab of tabs) {
        if (isSpecialServiceTab(tab.url)) {
            const serviceKey = tab.url.split('/')[2]; // This will give 'docs.google.com' or 'chat.openai.com'
            if (!groupedTabs[serviceKey]) {
                groupedTabs[serviceKey] = [];
            }
            groupedTabs[serviceKey].push(tab.id);
        } else {
            if (!groupedTabs['others']) {
                groupedTabs['others'] = [];
            }
            groupedTabs['others'].push(tab.id);
        }
    }
    return groupedTabs;
}

// Function to hibernate the oldest tabs exceeding the limit, excluding tabs playing media
async function hibernateTabsIfNeeded() {
    console.log('Checking if hibernation is needed...');
    console.log('Active tabs before hibernation:', activeTabs);

    if (activeTabs.length > 10) {
        const tabsToHibernate = activeTabs.length - 10;
        let hibernatedTabsCount = 0;

        // Group special service tabs
        const groupedTabs = groupSpecialServiceTabs(activeTabs.map(id => ({ id, url: '' })));

        // Flatten the grouped tabs while ensuring only one tab per special service is kept active
        let tabsToCheck = [];
        for (const key in groupedTabs) {
            if (groupedTabs[key].length > 1 && key !== 'others') {
                tabsToCheck.push(groupedTabs[key][0]); // Keep one tab from special services
                groupedTabs[key].shift(); // Remove the kept tab
                tabsToCheck.push(...groupedTabs[key]); // Add remaining tabs for possible hibernation
            } else {
                tabsToCheck.push(...groupedTabs[key]);
            }
        }

        for (let i = 0; i < tabsToCheck.length && hibernatedTabsCount < tabsToHibernate; i++) {
            const tabIdToCheck = tabsToCheck[i];
            const isPlayingMedia = await isTabPlayingMedia(tabIdToCheck);
            if (!isPlayingMedia) {
                const tabIdToHibernate = activeTabs.splice(activeTabs.indexOf(tabIdToCheck), 1)[0];
                chrome.tabs.discard(tabIdToHibernate);
                console.log(`Hibernated tab ID: ${tabIdToHibernate}`);
                hibernatedTabsCount++;
                i--;
            }
        }
    }

    console.log('Active tabs after hibernation:', activeTabs);
}

// Retrieve all non-discarded tabs when the extension starts
chrome.tabs.query({ discarded: false }, function(tabs) {
    activeTabs = tabs.map(tab => tab.id);
    console.log('Initial active tabs:', activeTabs);
    hibernateTabsIfNeeded();
});

// Listen for tab creation events
chrome.tabs.onCreated.addListener(function(tab) {
    if (!tab.discarded) {
        activeTabs.push(tab.id);
        console.log('Tab created:', tab.id);
    }
    hibernateTabsIfNeeded();
});

// Listen for tab removal events
chrome.tabs.onRemoved.addListener(function(tabId, removeInfo) {
    activeTabs = activeTabs.filter(id => id !== tabId);
    console.log('Tab removed:', tabId);
});

// Listen for tab update events (e.g., when a hibernated tab gets loaded again)
chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.status === 'complete' && !tab.discarded) {
        if (!activeTabs.includes(tabId)) {
            activeTabs.push(tabId);
            console.log('Tab updated and added:', tabId);
            hibernateTabsIfNeeded();
        }
    }
});