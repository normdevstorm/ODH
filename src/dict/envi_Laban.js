/* global api */
class envi_Laban {
    constructor(options) {
        this.options = options;
        this.maxexample = 2;
        this.word = '';
    }

    async displayName() {
        return 'Laban EN->VI Dictionary';
    }

    setOptions(options) {
        this.options = options;
        this.maxexample = options.maxexample;
    }

    async findTerm(word) {
        this.word = word;
        return await this.findLaban(word);
    }

    async findLaban(word) {
        let notes = [];
        if (!word) return notes;

        function T(node) {
            if (!node) return '';
            return node.innerText.trim();
        }

        let url = 'https://dict.laban.vn/find?type=1&query=' + encodeURIComponent(word);
        let doc;
        try {
            let data = await api.fetch(url);
            let parser = new DOMParser();
            doc = parser.parseFromString(data, 'text/html');
        } catch (err) {
            return [];
        }

        // Expression and phonetic from the EN-VI (tab 0) header
        // HTML: <div class="fl word_tab_title word_tab_title_0">
        //         <h2 class="fl">beautiful <span class="color-black">/'bju:tifl/</span>...</h2>
        let header = doc.querySelector('.word_tab_title_0 h2');
        if (!header) return notes;

        let phonSpan = header.querySelector('.color-black');
        let reading = phonSpan ? T(phonSpan) : '';

        // Clone h2 and strip the phonetic span to get a clean expression
        let hClone = header.cloneNode(true);
        let spToRemove = hClone.querySelector('.color-black');
        if (spToRemove) spToRemove.parentNode.removeChild(spToRemove);
        let expression = T(hClone);

        // EN-VI definitions are in the first slide tab (rel="0" = Anh-Việt)
        // HTML structure inside .content:
        //   <div class="bg-grey bold font-large m-top20"><span>Tính từ</span></div>  ← POS
        //   <div class="green bold margin25 m-top15">đẹp, hay</div>                  ← definition
        //   <div class="color-light-blue margin25 m-top15">a beautiful girl</div>    ← EN example
        //   <div class="margin25">cô gái đẹp</div>                                   ← VI translation
        let contentDiv = doc.querySelector('li.slide_content[rel="0"] .content');
        if (!contentDiv) return notes;

        let definitions = [];
        let children = Array.from(contentDiv.children);
        let currentPos = '';

        for (let i = 0; i < children.length; i++) {
            let cls = children[i].className;

            if (cls.includes('bg-grey') && cls.includes('font-large')) {
                // Part of speech heading — store for the next definition(s)
                currentPos = T(children[i]);

            } else if (cls.includes('green') && cls.includes('bold') && cls.includes('margin25')) {
                // Vietnamese definition
                let defText = T(children[i]);
                let posTag = currentPos ? `<span class='pos'>${currentPos}</span> ` : '';
                currentPos = ''; // show POS label only on the first def of each group

                let definition = `${posTag}<span class='vi_tran'>${defText}</span>`;

                // Look ahead for example sentences immediately following this definition
                let exampleCount = 0;
                while (i + 1 < children.length && exampleCount < this.maxexample) {
                    let nextCls = children[i + 1].className;
                    if (nextCls.includes('color-light-blue') && nextCls.includes('margin25')) {
                        // EN example sentence
                        i++;
                        let enSent = T(children[i]);
                        let viSent = '';
                        // The very next sibling (class="margin25") is the VI translation
                        if (i + 1 < children.length && children[i + 1].className.trim() === 'margin25') {
                            i++;
                            viSent = T(children[i]);
                        }
                        if (exampleCount === 0) definition += '<ul class="sents">';
                        definition += `<li class='sent'><span class='en_sent'>${enSent}</span><span class='vi_sent'>${viSent}</span></li>`;
                        exampleCount++;
                    } else {
                        break; // stop at next def or POS block
                    }
                }
                if (exampleCount > 0) definition += '</ul>';

                definitions.push(definition);
            }
        }

        if (definitions.length === 0) return notes;

        // Fetch UK / US audio URLs via Laban's getsound API
        // API: GET /ajax/getsound?accent=uk&word={word}  → {"error":"0","data":"https://...mp3"}
        let audios = ['', ''];
        try {
            let ukRaw = await api.fetch('https://dict.laban.vn/ajax/getsound?accent=uk&word=' + encodeURIComponent(word));
            let ukJson = JSON.parse(ukRaw);
            // TODO: TO RETREIVE AUDIO URL RIGHT HERE.
            if (ukJson && ukJson.error == '0') audios[0] = ukJson.data;
        } catch (e) { /* audio unavailable */ }
        try {
            let usRaw = await api.fetch('https://dict.laban.vn/ajax/getsound?accent=us&word=' + encodeURIComponent(word));
            let usJson = JSON.parse(usRaw);
            if (usJson && usJson.error == '0') audios[1] = usJson.data;
        } catch (e) { /* audio unavailable */ }

        notes.push({
            css: this.renderCSS(),
            expression,
            reading,
            definitions,
            audios
        });
        return notes;
    }

    renderCSS() {
        return `<style>
            span.pos      { text-transform: lowercase; font-size: 0.9em; margin-right: 5px; padding: 2px 4px; color: white; background-color: #e53935; border-radius: 3px; }
            span.vi_tran  { color: #333; }
            ul.sents      { font-size: 0.85em; list-style: square inside; margin: 3px 0; padding: 5px; background: rgba(229,57,53,0.08); border-radius: 5px; }
            li.sent       { margin: 2px 0; padding: 0; }
            span.en_sent  { margin-right: 5px; }
            span.vi_sent  { color: #e53935; }
        </style>`;
    }
}
