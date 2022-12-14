
$.fn.serializeObject = function() {
    var o = {};
    var a = this.serializeArray();
    $.each(a, function() {
        if (o[this.name]) {
            if (!o[this.name].push) {
                o[this.name] = [o[this.name]];
            }
            o[this.name].push(this.value || '');
        } else {
            o[this.name] = this.value || '';
        }
    });
    return o;
};

;(function (root, factory) {

    if (typeof define === 'function' && define.amd) {
        define(factory);
    } else if (typeof exports === 'object') {
        module.exports = factory();
    } else {
        root.Slideshow = factory();
    }

})(this, function () {

    var Slideshow = window.Slideshow = {};
        Slideshow.version = '0.1.0';

    var Dict = Slideshow.dict = {};
    var Instance = Slideshow.instance = undefined;
    var Settings = Slideshow.settings = {
        selector    : ".slideshow",
        timeout     : "5000ms", // default timeout
        max         : -1,
        transition  : "opacity",
        tick        : "500ms",
        keyControl  : undefined,
        clickControl: undefined,
        focus       : true,
        autocomplete: undefined
    };

    const State = Slideshow.state = {
        PLAY         : "play",
        SHOW         : "show",
        PREVENT      : "prevent", // Prevent going to this image
        EMPTY        : "empty",
        ACTIVE       : "active",
        HOLD         : "hold",  // Overhead time until animation ends
        TIMEOUT      : "timeout", // Force slideshow time reset (when clicking on backward or forward button)

        REWIND       : "rewind",   // Reset to initial slide and keep current state (pause or play)
        FASTBACKWARD : "fast-backward",
        BACKWARD     : "backward",
        FORWARD      : "forward",
        FASTFORWARD  : "fast-forward",
    };

    const Key = Slideshow.key = {

        LEFT : 37,
        UP   : 38,
        RIGHT: 39,
        DOWN : 40,

        SHIFT : 16,
    }

    var debug = false;
    var ready = false;

    Slideshow.parseDuration = function(str) {

        var array = String(str).split(", ");
            array = array.map(function(t) {

                if(String(t).endsWith("ms")) return parseFloat(String(t))/1000;
                return parseFloat(String(t));
            });

        return Math.max(...array);
    }

    Slideshow.get = function(key) {

        if(key in Slideshow.settings)
            return Slideshow.settings[key];

        return null;
    };

    Slideshow.set = function(key, value) {

        Slideshow.settings[key] = value;
        return this;
    };

    Slideshow.add = function(key, value) {

        if(! (key in Slideshow.settings))
            Slideshow.settings[key] = [];

        if (Slideshow.settings[key].indexOf(value) === -1)
            Slideshow.settings[key].push(value);

        return this;
    };

    Slideshow.remove = function(key, value) {

        if(key in Slideshow.settings) {

            Slideshow.settings[key] = Slideshow.settings[key].filter(function(setting, index, arr){
                return value != setting;
            });

            return Slideshow.settings[key];
        }

        return null;
    };

    Slideshow.configure = function (options) {

        var key, value;
        for (key in options) {
            value = options[key];
            if (value !== undefined && options.hasOwnProperty(key)) Settings[key] = value;
        }

        if(debug) console.log("Slideshow configuration: ", Settings);

        return this;
    };

    Slideshow.isReady = function() { return ready; }

    Slideshow.uuidv4 = function() {
        return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
          (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
        );
    };

    Slideshow.ready = function (options = {}) {

        if("debug" in options)
            debug = options["debug"];

        Slideshow.configure(options);
        ready = true;

        if(debug) console.log("Slideshow is ready.");
        dispatchEvent(new Event('slideshow:ready'));

        if (Slideshow.empty())
            Slideshow.onLoad();

        Slideshow.run(function() {

            $(Slideshow.get("selector")).each(function() {

                Slideshow.run(); // Compute pictures
                if ($(this).hasClass(Slideshow.state.PLAY) || $(this).data("timeout"))
                    Slideshow.play(this);
            });
        });

        return this;
    };

    Slideshow.empty  = function() { return Object.keys(Slideshow.dict).length === 0; }
    Slideshow.clear  = function()
    {
        $(Slideshow.dict).each(function(id) {

            var that = Slideshow.dict[id];
            if(that == undefined) return;

            clearInterval(that.internal);
            if (that.observer !== undefined)
                that.observer.disconnect();
        });

        Slideshow.dict = {};
    }

    Slideshow.onLoad = function(selector = Slideshow.get("selector")) {

        Slideshow.clear();
        $(selector).each(function() {

            this.id = this.id || Slideshow.uuidv4();
            Slideshow.dict[this.id] = {
                container: this, instance: undefined, transitions: undefined, transitions_default: undefined,
                observer:undefined, first:undefined, last:undefined, onHold:false,
                progress:0, timeout: undefined, isHover:false, isSelected: false};

            var entries = $(this).find(".slideshow-entry");
            if(entries.length < 1) $(this).addClass(Slideshow.state.EMPTY);
            else $(this).addClass(Slideshow.state.REMOVE);

            var observer = new MutationObserver(function(mutations) {
                mutations.forEach(function(mutation) {
                    var attributeValue = $(mutation.target).prop(mutation.attributeName);
                    console.log("Slideshow "+mutation.target.id+" changed to:", attributeValue);
                });
            });

            if(debug > 0) observer.observe(this, { attributes: true, attributeFilter: ['class']});

            Slideshow.run(function() {

                if (Slideshow.get("play"))
                    Slideshow.play(this);

            }.bind(this));
        });

        if(debug) {

            var slideshows = Slideshow.length(selector);
            if (slideshows.length < 1) console.log("Slideshow: no slideshow found");
            else {

                console.log("Slideshow: " + slideshows.length + " slideshow(s) found");
                $(slideshows).each(function(index) { console.log("- Slider #"+(index+1)+" ("+ this + " image(s) found)", $(selector)[index] ); });
            }
        }
    }

    Slideshow.call = function(
        entry,
        that = undefined /* slideshow container (default class naming might be different that ."slideshow") */
    ) {
        if(!$(entry).hasClass("slideshow-entry")) {
            console.error("Failed to load entry..", entry, " no class \"slideshow-entry\" found");
            return undefined;
        }

        if($(entry).hasClass("ready")) return entry;
        var entryID  = Array.from(entry.parentNode.children).indexOf(entry);

        var images  = [];
        var imageSrcs  = [];

        var _tmp = $(entry).find(".slideshow-image");
        Object.keys(_tmp).forEach(function(i) {

            var image = _tmp[i];
            var imageSrc = image.src ?? (image.dataset ? image.dataset.src : undefined);

            images.push(image);
            imageSrcs.push(imageSrc);
        });

        var images = $(entry).find(".slideshow-image").filter(function(k,v) { return imageSrcs.indexOf(this.src) === k && this.src !== undefined; });
        if(images.length < 2) Slideshow.pause(that);
        var image = $(images)[0] ?? undefined;

        if (image === undefined) {

            image = document.createElement("img");

            if(entry.dataset.imageClass) image.setAttribute("class", entry.dataset.imageClass + " slideshow-image");
            else image.setAttribute("class", "slideshow-image");

            if(entry.dataset.imageAlt) image.setAttribute("alt", entry.dataset.imageAlt);
            if(entry.dataset.imageStyle) image.setAttribute("style", entry.dataset.imageStyle);
            if(entry.dataset.image) {

                if(entry.getAttribute("loading") == "lazy") image.setAttribute("data-src", entry.dataset.image);
                else image.setAttribute("src", entry.dataset.image);
            }

            var href  = entry.dataset.href || undefined;
            if (href === undefined) entry.prepend(image);
            else {

                var link = document.createElement("a");
                    link.append(image);
                    link.setAttribute("href", href);
                    link.setAttribute("class", "slideshow-link");

                entry.prepend(link);
            }
        }

        if(that) {

            //
            // OPTIONAL: On click control
            $(image).on("click", function() {

                var clickControl = that.dataset.clickControl || Slideshow.get("clickControl");
                if (clickControl) {

                    Slideshow.forward(that.container);
                    Slideshow.run();
                }
            });

            //
            // OPTIONAL: Computation pagers
            $(that).find(".slideshow-pager").each(function(i) {

                var thumbnail = image.src ?? image.dataset.src ?? entry.dataset.image;
                var pagerPrototype = new DOMParser().parseFromString(this.dataset.prototype, "text/xml").firstChild;

                var prototype = $(this).find(".slideshow-page")[entryID] ?? pagerPrototype[i];
                $(this).find(".slideshow-page").each(function() {

                    $(prototype).find(".slideshow-thumbnail").each(function() {

                        if(image.dataset.src == undefined) this.setAttribute("src", thumbnail);
                        $(this).on("click", () => Slideshow.goto(that, entryID));
                    });

                    if(prototype === pagerPrototype[i]) $(this).append(prototype);
                });
            });
        }

        $(entry).addClass("ready");
        return entry;
    }

    Slideshow.asleep = function() {

        var asleep = true;
        Object.keys(Slideshow.dict).forEach(function(id) {
            asleep  &= !$(Slideshow.dict[id].container).hasClass(Slideshow.state.PLAY)
                    && !$(Slideshow.dict[id].container).hasClass(Slideshow.state.TIMEOUT)
                    && !$(Slideshow.dict[id].container).hasClass(Slideshow.state.HOLD)
        });

        return asleep;
    }

    Slideshow.run = function(callback = function() {}) {

        if(!Slideshow.isReady()) return;

        Slideshow.update();

        callback();

        if (Slideshow.instance !== undefined) return;
        if(debug > 1) console.log("[MASTER]","New call");

        var focus = Slideshow.get("focus");
        var focusList = [];
        Slideshow.instance = setInterval(function() {

            if(debug > 1) console.log("[MASTER]","Next iteration");
            Object.keys(Slideshow.dict).forEach(function(id) {

                var that = Slideshow.dict[id];
                if(Slideshow.get("focus") != focus) {

                    if(Slideshow.get("focus") == false) {

                        focusList.push(that.container.classList);
                        Slideshow.pause(that);

                    } else {

                        while(( selector = focusList.pop() ))
                            Slideshow.play(selector);
                    }
                }

                if(debug > 2) console.log("[SLAVE] ","State", that.container.classList);
                if($(that.container).hasClass(Slideshow.state.HOLD) || $(that.container).hasClass(Slideshow.state.TIMEOUT)) {

                    $(that.container).removeClass(Slideshow.state.TIMEOUT);
                    if (that.interval !== undefined) {

                        if(debug > 2) console.log("[SLAVE] ","Pause transition",id);
                        clearInterval(that.interval);
                        that.interval = undefined;
                    }

                } else if ($(that.container).hasClass(Slideshow.state.PLAY) || $(this).data("timeout")) {

                    Slideshow.updateProgress(that.container);

                    if (that.interval === undefined) {

                        if(debug > 2) console.log("[SLAVE] ","New call", id);
                        Slideshow.handleNavigation(that.container);
                        $(that.container).removeClass(Slideshow.state.TIMEOUT)

                        that.interval = setInterval(function() {

                            if(debug > 2) console.log("[SLAVE] ","Next iteration", id);
                            Slideshow.forward(that.container);
                            Slideshow.update(that.container);

                        }.bind(that), that.timeout || 1000*Slideshow.parseDuration(Slideshow.get("timeout")));

                    } else if ($(that.container).hasClass(Slideshow.state.TIMEOUT)) {

                        if (that.interval !== undefined) {

                            if(debug > 2) console.log("[SLAVE] ","Reset",id);
                            clearInterval(that.interval);
                            that.interval = undefined;
                        }

                    }

                } else if (that.interval !== undefined) {

                    if(debug > 2) console.log("[SLAVE] ","Fullstop",id);
                    clearInterval(that.interval);
                    that.interval = undefined;
                }
            });

            if(Slideshow.asleep() && Slideshow.instance != undefined) {

                if(debug > 0) console.log("[MASTER]","Fullstop");
                clearInterval(Slideshow.instance);
                Slideshow.instance = undefined;
            }

        }, 1000*Slideshow.parseDuration(Slideshow.get("tick")));
    }

    Slideshow.lastSelection = undefined;
    Slideshow.pauseSelection = {};
    Slideshow.handleNavigation = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() {

            var that = this;

            $(this).find(".slideshow-fast-backward").off("click");
            $(this).find(".slideshow-fast-backward").on ("click", function() {
                Slideshow.fastBackward(that);
                Slideshow.run();
            });
            $(this).find(".slideshow-backward").off("click");
            $(this).find(".slideshow-backward").on ("click", function() {
                Slideshow.backward(that);
                Slideshow.run();
            });
            $(this).find(".slideshow-pause").off("click");
            $(this).find(".slideshow-pause").on ("click", function() {
                Slideshow.pause(that);
                Slideshow.run();
            });
            $(this).find(".slideshow-play").off("click");
            $(this).find(".slideshow-play").on ("click", function() {
                Slideshow.play(that);
            });
            $(this).find(".slideshow-stop").off("click");
            $(this).find(".slideshow-stop").on ("click", function() {
                Slideshow.pause(that);
                Slideshow.rewind(that);
                Slideshow.run();
            });
            $(this).find(".slideshow-forward").off("click");
            $(this).find(".slideshow-forward").on ("click", function() {
                Slideshow.forward(that);
                Slideshow.run();
            });
            $(this).find(".slideshow-fast-forward").off("click");
            $(this).find(".slideshow-fast-forward").on ("click", function() {
                Slideshow.fastForward(that);
                Slideshow.run();
            });

            if(! this.id in Slideshow.pauseSelection)
                Slideshow.pauseSelection[this.id] = false;

            $(this).off("mouseenter.slideshow."+this.id);
            $(this).on ("mouseenter.slideshow."+this.id, function(){ if(that.id in Slideshow.dict && !Slideshow.pauseSelection[that.id]) Slideshow.dict[that.id].isHover = true; });
            $(this).off("mouseover.slideshow." +this.id);
            $(this).on ("mouseover.slideshow." +this.id, function(){ if(that.id in Slideshow.dict && !Slideshow.pauseSelection[that.id]) Slideshow.dict[that.id].isHover = true; });
            $(this).off("mouseleave.slideshow."+this.id);
            $(this).on ("mouseleave.slideshow."+this.id, function(){ if(that.id in Slideshow.dict && !Slideshow.pauseSelection[that.id]) Slideshow.dict[that.id].isHover = false; });

            $(this).on("click.slideshow."+this.id, function(event) {
                Object.entries(Slideshow.dict).forEach(([k,v]) => { v.isSelected = (k == that.id); });
            });

            $(document).off("keydown.slideshow."+this.id);
            $(document).on ("keydown.slideshow."+this.id, function(e) {

                if(Slideshow.dict[that.id] === undefined) return;
                if(!Slideshow.dict[that.id].isSelected && !Slideshow.dict[that.id].isHover) return;

                var isHover = Slideshow.dict[that.id].isHover;
                var keyControl = that.dataset.keyControl || Slideshow.get("keyControl");
                if (keyControl === true || (keyControl === undefined && isHover)) {

                    if(e.which == Slideshow.key.LEFT) {
                        Slideshow.backward(that);
                        Slideshow.run();
                    } else if(e.which == Slideshow.key.RIGHT) {
                        Slideshow.forward(that);
                        Slideshow.run();
                    }
                }

                if (e.which == Slideshow.key.SHIFT)
                    Slideshow.pause();

                if (e.key == "Shift" && e.altKey)
                    Slideshow.pauseSelection[that.id] = !Slideshow.pauseSelection[that.id];
            });

            $(document).off("keyup.slideshow."+this.id);
            $(document).on ("keyup.slideshow."+this.id, function(e){

                if(Slideshow.dict[that.id] === undefined) return;
                if(!Slideshow.dict[that.id].isSelected && !Slideshow.dict[that.id].isHover) return;

                if(Slideshow.pauseSelection[that.id]) return;
                if(e.which == Slideshow.key.SHIFT) Slideshow.play();
            });
        });
    }

    Slideshow.updateProgress = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() {

            if(!$(this).hasClass(Slideshow.state.PLAY)) return;

            //
            // Update timeout value if holding progress bar is found..
            //
            if(Slideshow.dict[this.id].timeout === undefined) {

                var timeout = 1000*Slideshow.parseDuration($(Slideshow.dict[this.id].container).data("timeout")) || 0;
                if(!timeout) timeout = 1000*Slideshow.parseDuration(Slideshow.get("timeout")) || 0;

                $(this).find(".slideshow-progress").each(function() {

                    var style = window.getComputedStyle(this, ":before");
                    var progressBarTimeout = 1000*Math.max(Slideshow.parseDuration(style["animation-duration"]),Slideshow.parseDuration(style["transition-duration"]));
                    if(this.dict != undefined && progressBarTimeout != timeout) {

                        console.error("Mismatch between selector \""+this.dict+"\" timeout \""+timeout+"ms\" and progress bar animation/transform timing \""+progressBarTimeout+"ms\": progressbar timing will be used", style);
                        timeout = progressBarTimeout;
                    }
                });

                if(timeout > 0) {

                    if(debug > 0) console.log("[SLAVE] ","New timing \""+timeout+"ms\" found set for ", this.id);
                    Slideshow.dict[this.id].timeout = timeout;
                }
            }

            //
            // Update relevant progress bar
            //
            var progress = $($(this).find(".slideshow-progress"))
                .not(".slideshow-pager .slideshow-progress")
                .add($(this).find(".slideshow-pager .slideshow-page.hold .slideshow-progress")
            );

            //
            // Update progress value
            //
            var nEntries = $(this).find(".slideshow-image").length;
            if (nEntries > 1) {

                var tick = 1000*Slideshow.parseDuration(Slideshow.get("tick"));
                var timeout = Slideshow.dict[this.id].timeout || 1000*Slideshow.parseDuration(Slideshow.get("timeout"));
                var dP = tick/timeout;

                Slideshow.dict[this.id].progress += dP;
                if (Slideshow.dict[this.id].progress > 1)
                    Slideshow.dict[this.id].progress = 1;
            }

            //
            // Optional: update progress bar progress information
            // (Commented because timeconsuming)
            //
            // var percentage = Slideshow.dict[this.id].progress;
            // $(progress).each(function() {

            //     // If progress bar comes from DOMParser().. this.dataset is undefined..
            //     if(this.dataset !== undefined) this.dataset.percentage = percentage;
            //     else $(this).data("percentage", percentage);
            // });
        });
    }

    Slideshow.modulo = function mod(n, m) { return ((n % m) + m) % m; }

    Slideshow.updatePosition = function(selector = Slideshow.get("selector"))
    {
        //
        // Update slideshow position
        //
        return $(Slideshow.find(selector)).map(function() {

            var entries = $(this).find(".slideshow-entry");
            if (Slideshow.dict[this.id].first === undefined)
                Slideshow.dict[this.id].first = this.dataset.first || 0;
            if (Slideshow.dict[this.id].last === undefined)
                Slideshow.dict[this.id].last = entries.length - 1;

            var position = previousPosition = this.dataset.position;
            var firstPosition = Slideshow.dict[this.id].first;
            var lastPosition  = Slideshow.dict[this.id].last;

            if($(this).hasClass(Slideshow.state.REWIND))
                position = firstPosition;
            else if($(this).hasClass(Slideshow.state.FASTBACKWARD))
                position = (position == firstPosition ? lastPosition : firstPosition);
            else if($(this).hasClass(Slideshow.state.FASTFORWARD))
                position = (position == lastPosition ? firstPosition : lastPosition);
            else if($(this).hasClass(Slideshow.state.BACKWARD))
                position--;
            else if($(this).hasClass(Slideshow.state.FORWARD))
                position++;

            var lastPosition = Slideshow.dict[this.id].last;
            position = Slideshow.modulo(position, lastPosition+1);

            $(this)
                .removeClass(Slideshow.state.FASTBACKWARD)
                .removeClass(Slideshow.state.BACKWARD)
                .removeClass(Slideshow.state.FORWARD)
                .removeClass(Slideshow.state.FASTFORWARD);

            //
            // Update entry
            //
            var entry = entries[position];

            var event = new CustomEvent('slideshow:update');
                event.slideshow = this;
                event.entry = entry

            dispatchEvent(event);

            $(entry).addClass(Slideshow.state.SHOW);
            $(entries).each(function() {
                return (this != entry ? $(this).removeClass(Slideshow.state.SHOW) : this);
            });

            //
            // OPTIONAL: Update pagers
            //
            $(this).find(".slideshow-pager").each(function() {

                $(this).find(".slideshow-page").removeClass(Slideshow.state.ACTIVE);
                $(this).find(".slideshow-page").eq(position).addClass(Slideshow.state.ACTIVE);

                $(this).find(".slideshow-page.active .slideshow-progress").removeClass(Slideshow.state.PREVENT);
                $(this).find(".slideshow-page:not(.active) .slideshow-progress").addClass(Slideshow.state.PREVENT);
            });

            //
            // Reset progress information
            //
            this.dataset.position = position;
            if(position != previousPosition)
                Slideshow.dict[this.id].progress = 0;
        });
    }

    Slideshow.callback = function(fn = function() {}, delay = 0)
    {
        if(delay == 0) fn();
        else setTimeout(fn, delay);
    }

    Slideshow.holdTiming = function(entry = undefined, timing = undefined)
    {
        var delay    = timing !== undefined ? timing.delay    : 0,
            duration = timing !== undefined ? timing.duration : 0;

        if(entry !== undefined) {

            var entryStyle = window.getComputedStyle(entry);

            delay    = Math.max(delay, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-delay"]),    Slideshow.parseDuration(entryStyle["transition-delay"])));
            duration = Math.max(duration, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-duration"]), Slideshow.parseDuration(entryStyle["transition-duration"])));

            var entryStyle = window.getComputedStyle(entry, ":before");
            delay    = Math.max(delay, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-delay"]),    Slideshow.parseDuration(entryStyle["transition-delay"])));
            duration = Math.max(duration, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-duration"]), Slideshow.parseDuration(entryStyle["transition-duration"])));

            var entryStyle = window.getComputedStyle(entry, ":after");
            delay    = Math.max(delay, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-delay"]),    Slideshow.parseDuration(entryStyle["transition-delay"])));
            duration = Math.max(duration, 1000*Math.max(Slideshow.parseDuration(entryStyle["animation-duration"]), Slideshow.parseDuration(entryStyle["transition-duration"])));
        }

        return {delay:delay, duration:duration};
    }

    Slideshow.update = function(selector = Slideshow.get("selector"))
    {
        return $(Slideshow.find(selector)).map(function() {

            //
            // Preload all images..
            //
            var entries = $(this).find(".slideshow-entry");
                entries.each(function(index, entry) {

                    var maxImages = Slideshow.get("max");
                    var nEntries = $(this).find(".slideshow-entry").length;

                    if(nEntries < 2) $(this).find(".slideshow-control").addClass("hidden");
                    if(nEntries < 2) Slideshow.pause(this);

                    var alreadyCalled = $(this).find(".slideshow-entry").length > 0;
                    if (maxImages > 0 && alreadyCalled && nEntries > maxImages) {

                        var image  = this.dataset.image;
                        console.error("Too many slides loaded in slideshow ", slideshow, "\n\"Image " + image + "\".. skip");

                        entry.remove();
                        delete entries[index];
                        return;
                    }

                    if (Slideshow.call(entry, this) === undefined) {
                        entry.remove();
                        delete entries[index];
                        return;
                    }

                    //
                    // Entry number
                    //
                    entry.dataset.num = index;

                    //
                    // Prepare transitions
                    //
                    if (Slideshow.dict[this.id].transitions === undefined )
                        Slideshow.dict[this.id].transitions = $(this).find(".slideshow-transition");

                    if (Slideshow.dict[this.id].transitions_default === undefined ) {
                        Slideshow.dict[this.id].transitions_default = [];
                        Slideshow.dict[this.id].transitions_default = Slideshow
                            .quadrant(Slideshow.dict[this.id].transitions)
                            .toArray()
                            .map((q, i) => (q !== "") ? q : Slideshow.get("transition"));
                    }

                    //
                    // Prepare class observer..
                    //
                    Slideshow.dict[this.id].observer = new MutationObserver(function(mutations) {

                        mutations.forEach(function(mutation) {

                            if(Slideshow.dict[this.id] === undefined) return;
                            if(Slideshow.dict[this.id].onHold) return;

                            // Process transitions
                            var transitions = Slideshow.dict[this.id].transitions.toArray();
                            var compass = Slideshow.quadrant(Slideshow.dict[this.id].transitions).toArray();
                                compass.forEach((q, i) =>  $(Slideshow.dict[this.id].transitions[i]).addClass(q === "" ? Slideshow.dict[this.id].transitions_default[i] : ""));

                            // Mark as hold
                            var classList = $(mutation.target).prop(mutation.attributeName).split(' ');
                            var isHolding = classList.includes(Slideshow.state.HOLD);
                            if(!isHolding) return;

                            var hold = Slideshow.holdTiming(entry);
                            transitions.forEach((t) => hold = Slideshow.holdTiming(t, hold));

                            var event = new CustomEvent('slideshow:hold');
                                event.slideshow = this;
                                event.entry = entry

                            dispatchEvent(event);

                            $(this).addClass(Slideshow.state.HOLD);

                            Slideshow.dict[this.id].onHold = true;
                            Slideshow.callback(function() {

                                //
                                // Update position
                                //
                                Slideshow.updatePosition(this);
                                position = this.dataset.position || 0;

                                // Remove on hold flag
                                $(this).removeClass(Slideshow.state.HOLD);

                                var hold = Slideshow.holdTiming(entry);
                                if(Slideshow.dict[this.id] === undefined) return;

                                var transitions = Slideshow.dict[this.id].transitions;
                                if (transitions !== undefined) transitions = transitions.toArray();
                                if (transitions !== undefined) transitions.forEach(() => hold = Slideshow.holdTiming(this, hold));

                                Slideshow.callback(function() {

                                    Slideshow.dict[this.id].onHold = false;
                                    Slideshow.clearQuadrant(Slideshow.dict[this.id].transitions);

                                }.bind(this), hold.delay + hold.duration);

                            }.bind(this), hold.delay + hold.duration);

                        }.bind(this));

                    }.bind(this));

                    Slideshow.dict[this.id].observer.observe(this, { attributes: true, attributeFilter: ['class']});
                    $(this).toggleClass(Slideshow.state.HOLD).toggleClass(Slideshow.state.HOLD);

                    //
                    // OPTIONAL: Prevent progress bar to start
                    //
                    var progress = $(
                        $(this).find(".slideshow-progress")).not(".slideshow-pager .slideshow-progress")
                        .add($(this).find(".slideshow-pager .slideshow-page.active .slideshow-progress")
                    );

                    var nEntries = $(this).find(".slideshow-entry").length;
                    if (nEntries < 2) $(progress).addClass(Slideshow.state.PREVENT);
                    else $(progress).removeClass(Slideshow.state.PREVENT);

                    //
                    // OPTIONAL: Update pagers
                    //
                    var event = new CustomEvent('slideshow:load');
                        event.slideshow = this;
                        event.entry = entry

                    dispatchEvent(event);

                }.bind(this));

            var position = this.dataset.position || 0;
            var entry = entries[position];
            if (entry === undefined) {

                $(this).addClass(Slideshow.state.EMPTY);
                return this;
            }

            $(this).find(".slideshow-pager").each(function() {

                $(this).find(".slideshow-page").removeClass(Slideshow.state.ACTIVE);
                $(this).find(".slideshow-page").eq(position).addClass(Slideshow.state.ACTIVE);

                $(this).find(".slideshow-page.active .slideshow-progress").removeClass(Slideshow.state.PREVENT);
                $(this).find(".slideshow-page:not(.active) .slideshow-progress").addClass(Slideshow.state.PREVENT);
            });

            $(entry).addClass(Slideshow.state.SHOW);
            $(this).removeClass(Slideshow.state.EMPTY);

            return this;
        });
    }

    Slideshow.quadrant = function(transitions = []) { return transitions.map(function() { return [this.classList].join(" ").replace("slideshow-transition", "").trim(); }); }
    Slideshow.clearQuadrant = function(transitions = []) { return transitions.map(function() { return $(this).removeClass().addClass("slideshow-transition"); }); }

    Slideshow.find         = function(selector = Slideshow.get("selector")) { return $(selector).filter(function() { return this.id in Slideshow.dict; }); }
    Slideshow.known        = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return this != undefined; }); }
    Slideshow.length       = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).find(".slideshow-entry").length; }); }

    Slideshow.play         = function(selector = Slideshow.get("selector"), options = {}) {

        return $(Slideshow.find(selector)).map(function() {

            var pause = Slideshow.pauseSelection[this.id] || false;
            if(!pause) {

                $(this).addClass(Slideshow.state.PLAY);
                Slideshow.run();
            }
        });
    }

    Slideshow.goto         = function(selector = Slideshow.get("selector"), position)
    {
        return $(Slideshow.find(selector)).map(function() {

            if(this.dataset.position == position) return;

            $(this).addClass(Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD);
            this.dataset.position = position;
        });
    }

    Slideshow.pause        = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).removeClass(Slideshow.state.PLAY); }); }
    Slideshow.rewind       = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.REWIND       + " " + Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD); }); }
    Slideshow.fastBackward = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FASTBACKWARD + " " + Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD); }); }
    Slideshow.backward     = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.BACKWARD     + " " + Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD); }); }
    Slideshow.forward      = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FORWARD      + " " + Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD); }); }
    Slideshow.fastForward  = function(selector = Slideshow.get("selector")) { return $(Slideshow.find(selector)).map(function() { return $(this).addClass(Slideshow.state.FASTFORWARD  + " " + Slideshow.state.TIMEOUT + " " + Slideshow.state.HOLD); }); }
    Slideshow.togglePlay   = function(selector = Slideshow.get("selector")) {
        return $(Slideshow.find(selector)).map(function() {
            $(this).toggleClass(Slideshow.state.PLAY);
            Slideshow.run();
        });
    }

    $(window).on("DOMContentLoaded",  function(e) { Slideshow.onLoad(); });
    $(window).on("focus", function(e){ Slideshow.set("focus", true); });
    $(window).on("blur",  function(e){ Slideshow.set("focus", false); });
    $(window).on("onbeforeunload",  function(e) { Slideshow.clear(); });

    return Slideshow;
});