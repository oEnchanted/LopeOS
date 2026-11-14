import { CustomAudioDecoder, registerDecoder, AudioSample, type EncodedPacket, type AudioCodec, type InputAudioTrack } from 'mediabunny';
import type { AACDecoder } from '@wasm-audio-decoders/aac';
const fallbackConfigs=new Set<string>();
function key(c:AudioDecoderConfig) {return `${c.codec}:${c.sampleRate}:${c.numberOfChannels}`;}
/** Native WebCodecs first; a bundled WASM decoder fills Chromium's AAC gap locally. */
export async function ensureAudioDecoder(track:InputAudioTrack|null|undefined) {
  if(!track||await track.getCodec()!=='aac')return;
  const config=await track.getDecoderConfig();if(!config)return;
  const supported=typeof AudioDecoder!=='undefined'&&await AudioDecoder.isConfigSupported(config).then(v=>v.supported).catch(()=>false);
  if(!supported)fallbackConfigs.add(key(config));
}
class LocalAACDecoder extends CustomAudioDecoder {
  private decoder?:AACDecoder;
  private timestamps:number[]=[];
  static supports(codec:AudioCodec,config:AudioDecoderConfig) {return codec==='aac'&&fallbackConfigs.has(key(config))&&/^mp4a\.(40\.(0?2|0?5|29)|67)$/.test(config.codec);}
  async init(){const {AACDecoder}=await import('@wasm-audio-decoders/aac');const d=this.config.description;const bytes=d?(ArrayBuffer.isView(d)?new Uint8Array(d.buffer,d.byteOffset,d.byteLength):new Uint8Array(d)):undefined;this.decoder=new AACDecoder({audioSpecificConfig:bytes});await this.decoder.ready;}
  async decode(packet:EncodedPacket){this.timestamps.push(packet.timestamp);const result=await this.decoder!.decodeFrames([packet.data]);if(result.errors.length)throw new Error(`AAC decoding failed: ${result.errors[0].message}`);if(!result.samplesDecoded)return;const count=result.samplesDecoded,channels=result.channelData.length,data=new Float32Array(count*channels);result.channelData.forEach((p,i)=>data.set(p,i*count));const timestamp=this.timestamps.shift()??packet.timestamp;this.onSample(new AudioSample({data,format:'f32-planar',sampleRate:result.sampleRate,numberOfChannels:channels,timestamp}));}
  flush(){this.timestamps=[];}
  close(){this.decoder?.free();this.decoder=undefined;this.timestamps=[];}
}
registerDecoder(LocalAACDecoder);
