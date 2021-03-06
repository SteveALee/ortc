
define([
    "ortc/util"
], function(UTIL) {

    var SDP = {};

    SDP.parse = function(sdp) {

        var info = {
            protocol: {},
            session: {},
            media: {}
        };

        var lines = sdp.split("\r\n");
        var parts = null;
        var m = null;

        var section = "session";
        var media = null;
        for (var i=0 ; i<lines.length ; i++) {

            // @see http://en.wikipedia.org/wiki/Session_Description_Protocol

            parts = lines[i].match(/^([^=]*)=(.*)$/);
            if (!parts) continue;

            // protocol version number, currently only 0
            if (parts[1] === "v") {
                info.protocol.version = parts[2];
            } else
            // originator and session identifier : username, id, version number, network address
            if (parts[1] === "o") {
                m = parts[2].match(/^(\S+)\s(\d+)\s(\d+)\sIN\sIP4\s([\d\.]+)$/);
                info.session.username = m[1];
                info.session.id = m[2];
                info.session.version = m[3];
                info.session.ip = m[4];
            } else
            // session name : mandatory with at least one UTF-8-encoded character
            if (parts[1] === "s") {
                info.session.name = parts[2];
            } else
            // time the session is active
            if (parts[1] === "t") {
                m = parts[2].match(/^(\d+)\s(\d+)$/);
                info.session.timeFrom = m[1];
                info.session.timeTo = m[1];
            } else
            // media name and transport address
            if (parts[1] === "m") {
                section = "media";
                m = parts[2].match(/^(\S+)\s(\d+)\s(\S+)\s([\d\s]+)$/);
                media = {
                    name: m[1],
                    index: m[2],
                    transport: m[3],
                    codecPriority: m[4].split(" "),
                    codecs: {},
                    crypto: [],
                    ssrcs: {}
                };
                info.media[media.name + ":" + media.index] = media;
            } else
            if (section === "session") {
                // zero or more session attribute lines
                if (parts[1] === "a") {
                    m = parts[2].match(/^([^:]+)(:\s*(.+))?$/);
                    info.session[m[1]] = m[3] || true;
                }
            } else
            if (section === "media") {
                // connection information — optional if included at session level
                if (parts[1] === "c") {
                    m = parts[2].match(/^IN\sIP4\s([\d\.]+)$/);
                    media.ip = m[1];
                } else
                // zero or more media attribute lines — overriding the Session attribute lines
                if (parts[1] === "a") {
                    // `a=crypto:0 AES_CM_128_HMAC_SHA1_32 inline:C2estnn9xW1eyJm/IihUoFIkEKHlzSZS32A5L4iw`
                    m = parts[2].match(/^([^:]+)(:(.+))?$/);
                    if (m[1] === "crypto") {
                        // "inline:" <key||salt> ["|" lifetime] ["|" MKI ":" length]
                        //       key||salt      concatenated master key and salt, base64 encoded
                        //                      (see [RFC3548], Section 3)
                        //       lifetime       master key lifetime (max number of SRTP or SRTCP
                        //                      packets using this master key)
                        //       MKI:length     MKI and length of the MKI field in SRTP packets
                        m = m[3].match(/^(\d+)\s(\S+)\sinline:([^\|]+)(\|([^\|]+))?(\|([^:]+):(\d+))?$/);
                        media.crypto.push({
                            priority: m[1],
                            algorithm: m[2],
                            keysalt: m[3],
                            lifetime: m[5],
                            mki: m[7],
                            mkiLength: m[8]
                        });
                    } else
                    // `a=rtpmap:111 opus/48000/2`
                    if (m[1] === "rtpmap") {
                        m = m[3].match(/^(\d+)\s([^\/]+)\/([^\/]+)(\/(\d*))?$/);
                        media.codecs[m[1]] = {
                            payloadId: parseInt(m[1]),
                            kind: media.mid,
                            name: m[2],
                            hzRate: parseInt(m[3])
                        }
                        if (m[4]) {
                            media.codecs[m[1]].channels = parseInt(m[5]);
                        }
                    } else
                    // `a=fmtp:111 minptime=10` - extra args for `opus` codec.
                    if (m[1] === "fmtp") {
                        m = m[3].match(/^(\d+)\s([^=]+)=(.+)$/);
                        media.codecs[m[1]][m[2]] = m[3];
                    } else
                    // `a=rtcp-fb:100 ccm fir` - extra args for `VP8` codec.
                    // `a=rtcp-fb:100 nack` - extra args for `VP8` codec.
                    if (m[1] === "rtcp-fb") {
                        m = m[3].match(/^(\d+)\s(.+)$/);
                        m[2].split(" ").forEach(function(option) {
                            media.codecs[m[1]][option] = true;
                        });
                    } else
                    if (m[1] === "ssrc") {
                        m = m[3].match(/^(\S+)\s([^:]+):(.+)$/);
                        if (!media.ssrcs[m[1]]) {
                            media.ssrcs[m[1]] = {};
                        }
                        media.ssrcs[m[1]][m[2]] = m[3];
                    } else
                    if (
                        m[1] === "sendrecv" ||
                        m[1] === "recvonly" ||
                        m[1] === "sendonly" ||
                        m[1] === "inactive"
                    ) {
                        media.streamMode = m[1];
                    } else {
                        media[m[1]] = m[3] || true;
                    }
                }
            }
        }

        return info;
    }

    SDP.generate = function(info) {

        // @see http://en.wikipedia.org/wiki/Session_Description_Protocol

        var sdp = [
            'v=' + info.protocol.version,
            'o=' + info.session.username + ' ' + info.session.id + ' ' + info.session.version + ' IN IP4 ' + info.session.ip,
            's=' + info.session.name,
            't=' + info.session.timeFrom + ' ' + info.session.timeTo,
            'a=group:' + ((typeof info.session.group === "string") ? info.session.group : ("BUNDLE " + Object.keys(info.session.group).join(" "))),
            'a=msid-semantic: ' + info.session["msid-semantic"]
        ];

        for (var id in info.media) {
            var media = info.media[id];

            // Must have same number of `m` lines on offer and answer
            // TODO: Investigate what `1` means.
            sdp.push('m=' + media.name + ' ' + media.index + ' ' + media.transport + ' ' + media.codecPriority.join(" "));

            // Will later change to found ICE IP
            sdp.push('c=IN IP4 ' + media.ip);
            sdp.push('a=rtcp:' + media.rtcp);

            sdp.push('a=ice-ufrag:' + media["ice-ufrag"]);
            sdp.push('a=ice-pwd:' + media["ice-pwd"]);
            sdp.push('a=ice-options:' + media["ice-options"]);

            if (media.extmap) {
                sdp.push('a=extmap:' + media.extmap);
            }
            sdp.push('a=' + media.streamMode);

            if (media.mid) {
                sdp.push('a=mid:' + media.mid);
            }
            if (media.bandwidth) {
                sdp.push('b=' + media.bandwidth);
            }
            if (media["rtcp-mux"]) {
                // Transport option `rtcp-mux`: true|false
                sdp.push('a=rtcp-mux');
            }

            if (media.crypto) {
                media.crypto.forEach(function(crypto) {
                    var inline = crypto.keysalt;
                    if (crypto.lifetime) {
                        inline += "|" + crypto.lifetime;
                    }
                    if (crypto.mki) {
                        inline += "|" + crypto.mki + ":" + crypto.mkiLength;
                    }
                    sdp.push('a=crypto:' + crypto.priority + ' ' + crypto.algorithm + ' inline:' + inline);
                });
            }

            if (media.codecs) {
                media.codecPriority.forEach(function(payloadId) {
                    var codec = media.codecs[payloadId];

                    // for rtpmap:
                    //   offer: what we are expecting to receive
                    //   answer: what other party is expecting to receive

                    sdp.push('a=rtpmap:' + codec.payloadId + ' ' + codec.name + '/' + codec.hzRate + ((typeof codec.channels !== "undefined")?"/"+codec.channels:""));

                    if (codec.name === "opus" && codec.minptime) {
                        sdp.push('a=fmtp:' + codec.payloadId + ' minptime=' + codec.minptime);
                    }
                    if (codec.name === "VP8" && codec.ccm && codec.fir) {
                        sdp.push('a=rtcp-fb:' + codec.payloadId + ' ccm fir');
                    }
                    if (codec.name === "VP8" && codec.nack) {
                        sdp.push('a=rtcp-fb:' + codec.payloadId + ' nack');
                    }
                });
            }

            if (media.maxptime) {
                sdp.push('a=maxptime:' + media.maxptime);
            }

            if (media.ssrcs) {
                for (var ssrcId in media.ssrcs) {
                    var ssrc = media.ssrcs[ssrcId];

                    sdp.push('a=ssrc:' + ssrcId + ' cname:' + ssrc.cname);
                    sdp.push('a=ssrc:' + ssrcId + ' msid:' + ssrc.msid);
                    if (ssrc.mslabel) {
                        sdp.push('a=ssrc:' + ssrcId + ' mslabel:' + ssrc.mslabel);
                    }
                    if (ssrc.label) {
                        sdp.push('a=ssrc:' + ssrcId + ' label:' + ssrc.label);
                    }
                }
            }
        }

        sdp.push('');

        return sdp.join("\r\n");
    }

    SDP.generateSdpObject = function(info, streams) {

        var sdp = {
            protocol: {
                "version": 0
            },
            session: {
                "username": "-",
                "id": info._sessionId,
                "version": info._sessionVersion,
                "ip": "0.0.0.0",
                "name": "-",
                "timeFrom": "0",
                "timeTo": "0",
                "group": "-",
                "msid-semantic": "WMS"
            }
        };

        streams.forEach(function(streamInfo) {

            if (streamInfo.kind === "MediaStream" || streamInfo.kind === "DataStream") {

                sdp.session["msid-semantic"] = "WMS";

                if (!sdp.media) {
                    sdp.media = {};
                }

                streamInfo.description.tracks.forEach(function (track) {
                    if (typeof sdp.session["group"] === "string") {
                        sdp.session["group"] = {};
                    }
                    sdp.session["group"][track.kind] = true;

                    var ssrcs = {};

                    ssrcs[parseInt(track.ssrc)] = {
                        cname: streamInfo.description.cname,
                        msid: (track.msid || streamInfo.id) + " " + (track.msid || streamInfo.id) + track.kind.substring(0, 1) + "0",
                        mslabel: (track.msid || streamInfo.id),
                        label: (track.msid || streamInfo.id) + track.kind.substring(0, 1) + "0"
                    };

                    var codecs = {};
                    var media = {
                        "name": (track.kind === "data") ? "application" : track.kind,
                        "index": "1",
                        "transport": "RTP/SAVPF",
                        "codecPriority": streamInfo.constraints.codecs.filter(function(codec) {
                            if (codec.kind === track.kind) return true;
                            return false;
                        }).map(function(codec) {
                            codecs[codec.payloadId] = codec;
                            return codec.payloadId;
                        }),
                        "codecs": codecs,
                        "crypto": streamInfo.constraints.crypto.map(function(crypto) {
                            crypto = UTIL.deepCopy(crypto);
                            crypto.keysalt = streamInfo.description.secret;
                            return crypto;
                        }),
                        "ssrcs": ssrcs,
                        "ip": "0.0.0.0",
                        "rtcp": "1 IN IP4 0.0.0.0",
                        "ice-ufrag": streamInfo.description.contextId,
                        // chrome uses: randomHex(12)
                        "ice-pwd": streamInfo.description.secret.substring(0, 24),
                        "ice-options": "google-ice",
                        "streamMode": "sendrecv",
                        "mid": track.kind,
                        "rtcp-mux": true
                    }
                    if (track.kind === "audio") {
                        media.maxptime = 60;
                        media.extmap = "1 urn:ietf:params:rtp-hdrext:ssrc-audio-level";
                    } else
                    if (track.kind === "video") {
                        media.extmap = "2 urn:ietf:params:rtp-hdrext:toffset";
                    } else
                    if (track.kind === "data") {
                        media.bandwidth = "AS:30";
                    }
                    sdp.media[track.kind + ":1"] = media;
                });

            } else {
                throw new Error("Stream type for id '" + streamInfo.id + "' not supported!");
            }
        });

        return sdp;
    }

    SDP.parseSdpObject = function(sdpObject) {

        var info = {
            sessionId: sdpObject.session.id,
            sessionVersion: sdpObject.session.version,
            streams: {}
        };

        for (var mediaId in sdpObject.media) {
            var media = sdpObject.media[mediaId];

            for (var ssrcId in media.ssrcs) {
                var ssrc = media.ssrcs[ssrcId];

                var stream = {
                    id: ssrc.msid.split(" ")[0]
                };
                if (info.streams[stream.id]) {
                    stream = info.streams[stream.id];
                } else {
                    info.streams[stream.id] = stream;
                }

                stream.description = {
                    cname: ssrc.cname,
                    contextId: media["ice-ufrag"],
                    secret: media.crypto[0].keysalt,
                    tracks: (stream.description && stream.description.tracks) || []
                };
                stream.description.tracks.push({
                    kind: media.mid,
                    ssrc: parseInt(ssrcId),
                    track: ssrc.msid.split(" ")[1]
                });

                stream.constraints = {
                    codecs: ((stream.constraints && stream.constraints.codecs) || []).concat(media.codecPriority.map(function(payloadId) {
                        return media.codecs[payloadId];
                    })),
                    crypto: [
                        {
                            algorithm: media.crypto[0].algorithm,
                            priority: parseInt(media.crypto[0].priority)
                        }
                    ]
                };
            }
        }

        return info;
    }

    return SDP;

});
