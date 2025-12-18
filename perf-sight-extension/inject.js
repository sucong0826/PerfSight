// inject.js
(function() {
    const originalLog = console.log;
    const originalInfo = console.info;

    function sendToPerfSight(type, args) {
        try {
            // Convert args to string carefully to capture meaningful log content
            const message = args.map(arg => {
                if (typeof arg === 'object') {
                    try {
                        return JSON.stringify(arg);
                    } catch (e) {
                        return String(arg);
                    }
                }
                return String(arg);
            }).join(' ');

            window.postMessage({
                source: 'perfsight-inject',
                type: 'console_log',
                level: type,
                content: message,
                timestamp: Date.now()
            }, '*');
        } catch (e) {
            // ignore
        }
    }

    console.log = function(...args) {
        sendToPerfSight('log', args);
        originalLog.apply(console, args);
    };

    console.info = function(...args) {
        sendToPerfSight('info', args);
        originalInfo.apply(console, args);
    };
    
    // Support Custom Event directly (Scheme 3)
    window.addEventListener('perfsight-metric', (event) => {
        if (event.detail) {
             window.postMessage({
                source: 'perfsight-inject',
                type: 'custom_metric',
                payload: event.detail,
                timestamp: Date.now()
            }, '*');
        }
    });

})();


