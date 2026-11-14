import { Settings, Palette, Dock, Monitor, PanelTop, Search, Image, Bell, Volume2, Accessibility, Shield, ShieldCheck, UserRound, CloudSun, AppWindow, Download } from 'lucide-react';
import { AccountIcon } from '../../shell/Icons';
import type { PreferenceKey } from '../../../../../packages/contracts/src/preferences';
export const categories = [
  { id: 'general', title: 'General', icon: Settings, color: '#8296a6', group: 'WORKSPACE' },
  { id: 'updates', title: 'Software Update', icon: Download, color: '#6f94a7', group: '' },
  { id: 'account', title: 'LopeOS Account', icon: AccountIcon, color: '#5a9c9f', group: '' },
  { id: 'appearance', title: 'Appearance', icon: Palette, color: '#9b80d7', group: 'PERSONALIZE' },
  { id: 'dock', title: 'Desktop & Dock', icon: Dock, color: '#4d9fca', group: '' },
  { id: 'display', title: 'Display & Scale', icon: Monitor, color: '#588cca', group: '' },
  { id: 'menubar', title: 'Menu Bar', icon: PanelTop, color: '#788fa7', group: '' },
  { id: 'search', title: 'Search', icon: Search, color: '#7d91dc', group: '' },
  { id: 'wallpaper', title: 'Wallpaper', icon: Image, color: '#54a8b4', group: '' },
  { id: 'notifications', title: 'Notifications & Focus', icon: Bell, color: '#d4889f', group: 'COMFORT & FOCUS' },
  { id: 'sound', title: 'Sound', icon: Volume2, color: '#d39785', group: '' },
  { id: 'accessibility', title: 'Accessibility', icon: Accessibility, color: '#69a6cf', group: '' },
  { id: 'session', title: 'Session & Privacy Screen', icon: Shield, color: '#8b9fc5', group: 'PRIVACY & ACCESS' },
  { id: 'privacy', title: 'Privacy & Security', icon: ShieldCheck, color: '#74a998', group: '' },
  { id: 'profile', title: 'Profile', icon: UserRound, color: '#779ac2', group: '' },
  { id: 'weather', title: 'Weather', icon: CloudSun, color: '#63b4d2', group: 'APPLICATIONS' },
  { id: 'applications', title: 'Applications', icon: AppWindow, color: '#8299b3', group: '' },
] as const;
export type CategoryId = typeof categories[number]['id'];
export interface Field { key: PreferenceKey; label: string; description?: string; type: 'switch'|'slider'|'select'|'color'; options?: [string|number, string][]; min?: number; max?: number; step?: number; unit?: string }
const select = (key: PreferenceKey, label: string, options: Field['options'], description?: string): Field => ({ key, label, options, description, type: 'select' });
const toggle = (key: PreferenceKey, label: string, description?: string): Field => ({ key, label, description, type: 'switch' });
const slider = (key: PreferenceKey, label: string, min: number, max: number, unit = '%', step = 1, description?: string): Field => ({ key, label, min, max, unit, step, description, type: 'slider' });
export const fields: Partial<Record<CategoryId, Field[]>> = {
  general: [select('region','Region',[['en-US','United States'],['en-GB','United Kingdom'],['de-DE','Germany'],['fr-FR','France'],['ja-JP','Japan']], 'Changes LopeOS date formatting, not your device clock.'), select('dateStyle','Date format',[['short','Short'],['medium','Medium'],['long','Long']]), toggle('clock24','Use a 24-hour clock'), toggle('restoreLayout','Restore windows on startup','Reopen saved windows when LopeOS starts in this browser.')],
  appearance: [slider('glassClarity','Glass clarity',0,100,'%',1,'More clarity lets the wallpaper show through desktop chrome.'), { key:'accent',label:'Accent color',type:'color' }, { key:'selection',label:'Text highlight color',type:'color' }, { key:'folderColor',label:'Folder color',type:'color' }, slider('sidebarIconSize','Sidebar icon size',14,24,' px'), toggle('wallpaperTinting','Tint chrome with the wallpaper','Personal images use your accent as a consistent fallback.')],
  dock: [slider('dockSize','Dock size',36,68,' px',2), toggle('dockMagnification','Magnify Dock icons'), select('dockPosition','Position on screen',[['bottom','Bottom'],['left','Left'],['right','Right']]), toggle('dockAutoHide','Automatically hide the Dock','Reveal it from the edge, or focus it using the keyboard.'), select('windowAnimation','Window animation',[['gentle','Gentle'],['none','None']]), toggle('runningIndicators','Show running indicators'), toggle('showRecentApps','Show recently opened apps'), select('minimizeDestination','Minimize windows into',[['app','Application icon'],['dock','Separate Dock item']]), select('titlebarDoubleClick','Double-click a title bar to',[['maximize','Maximize or restore'],['minimize','Minimize'],['none','Do nothing']]), select('showDesktopBehavior','Show Desktop action',[['toggle','Hide or restore windows'],['minimize','Minimize all windows']])],
  display: [slider('interfaceScale','Interface scale',80,150,'%',5,'Scales LopeOS within this browser. Browser zoom remains separate.'), slider('textSize','Shared interface text',85,150,'%',5,'Enlarges shared labels and controls. Document and image canvases keep their own zoom.'), select('density','Control spacing',[['compact','Compact'],['default','Default'],['comfortable','Comfortable']]), select('effectsQuality','Visual effects',[['high','Full glass'],['balanced','Balanced'],['low','Simple surfaces']], 'Lower settings reduce blur and shadow work.')],
  menubar: [select('menuBarVisibility','Menu bar visibility',[['always','Always visible'],['auto','Automatically hide']], 'Alt+F10 reveals the menus when hidden.'), slider('menuBarStrength','Background strength',15,100), toggle('clockDate','Show the date'), toggle('clockWeekday','Show the day of the week'), toggle('clockSeconds','Show seconds'), toggle('clock24','Use a 24-hour clock'), slider('recentItemCount','Recent application count',0,12,'')],
  search: [toggle('searchApps','Applications'), toggle('searchCommands','Active application commands'), toggle('searchFiles','Workspace file names','Only names in your selected, authorized folders are searched.'), select('searchHistoryDays','Keep search history',[[0,'Do not keep'],[1,'1 day'],[7,'7 days'],[30,'30 days']]), select('searchShortcut','Open search with',[['Mod+K','⌘ / Ctrl + K'],['Alt+Space','Alt + Space']], 'Search is also available in the menu bar and Dock.')],
  wallpaper: [select('wallpaperFit','Picture placement',[['fill','Fill'],['fit','Fit'],['center','Center']]), select('wallpaperRotation','Rotate gallery wallpapers',[[0,'Off'],[5,'Every 5 minutes'],[15,'Every 15 minutes'],[30,'Every 30 minutes'],[60,'Every hour']], 'Rotation uses original and approved images, plus your upload, while this tab is visible.')],
  notifications: [toggle('dnd','Do Not Disturb','Silences LopeOS alerts and sounds. Other applications are unaffected.'), toggle('presentationMode','Presentation mode','Hide notification content. Also applied during a LopeOS screen capture preview.'), select('notificationPreviews','Show notification previews',[['always','Always'],['when-active','While LopeOS is active'],['never','Never']]), toggle('notificationBadges','Show app badges'), select('notificationHistoryDays','Keep notification history',[[0,'Do not keep'],[1,'1 day'],[7,'7 days'],[30,'30 days']])],
  sound: [slider('soundVolume','LopeOS volume',0,100), toggle('soundMuted','Mute LopeOS'), select('alertSound','Alert sound',[['glass','Glass'],['drop','Droplet'],['soft','Soft tone']]), slider('alertVolume','Alert volume',0,100), toggle('interfaceSounds','Play interface sounds','For LopeOS application launches, after a user interaction.')],
  accessibility: [toggle('reduceMotion','Reduce motion'), toggle('reduceTransparency','Reduce transparency','Readable solid surfaces override glass clarity.'), toggle('increaseContrast','Increase contrast'), toggle('nonColorIndicators','Use shape and text indicators','Adds visible switch marks and window-control symbols.'), toggle('strongFocus','Stronger keyboard focus'), toggle('hoverText','Enlarge focused and hovered labels','Shows a larger label for shared buttons without reading document content.'), slider('textSize','Shared interface text',85,150,'%',5), slider('speechRate','Read-aloud speed',.5,1.5,'×',.1), toggle('mediaCaptions','Prefer captions in supported media','Applies to caption tracks provided by LopeOS media, not all device audio.')],
  session: [select('idlePrivacyMinutes','Show privacy screen after',[[0,'Never'],[1,'1 minute'],[5,'5 minutes'],[15,'15 minutes'],[30,'30 minutes'],[60,'1 hour']], 'Uses inactivity in LopeOS and rechecks the deadline when this tab resumes.'), toggle('privacyOnHidden','Hide the workspace when leaving this tab')],
  privacy: [toggle('cameraTools','Allow LopeOS camera previews'), toggle('microphoneTools','Allow LopeOS microphone tests'), toggle('screenTools','Allow LopeOS screen capture previews'), toggle('locationAccess','Allow LopeOS location requests','Turning this off stops a pending request. Manual weather locations still work.'), toggle('clipboardHistory','Keep explicit clipboard interactions','This tab only: copied, cut, pasted, and imported text. Password fields are excluded. Pinned items also expire.'), select('clipboardRetentionMinutes','Clipboard retention',[[1,'1 minute'],[15,'15 minutes'],[60,'1 hour']]), toggle('diagnostics','Keep local diagnostic events','Optional event types and timestamps only. No text, paths, or credentials are recorded.')],
  weather: [select('weather.units','Temperature units',[['celsius','Celsius (°C)'],['fahrenheit','Fahrenheit (°F)']]), toggle('weatherAutoRefresh','Refresh weather automatically','Checks at most every 15 minutes while visible. Manual refresh remains available.')],
};
export const extraSearch = [
  ['general','about','About version build update'],['general','storage','Storage browser workspace cloud LopeDrive reset'],
  ['updates','software-update','Software update download install cached offline release version build size'],
  ['account','account','Account sign in login create register sync backup cloud LopeDrive storage quota files settings apps photos wallpaper recovery'],
  ['general','factory-reset','Reset LopeOS factory reset erase accounts settings data start over fresh setup'],
  ['general','startup','Startup applications login launch'],['appearance','theme','Light dark system appearance'],['appearance','iconStyle','Default dark clear tinted icons'],
  ['menubar','status-items','Status items order clock weather runtime connection'],
  ['search','search-scope','Search folder roots exclusions history'],
  ['wallpaper','wallpaper-gallery','Wallpaper gallery upload creator attribution perfecthue'],
  ['notifications','app-notifications','Per-app alerts badges sounds browser permission'],
  ['sound','microphone-test','Microphone input output devices test'],
  ['accessibility','read-aloud','Read aloud speech synthesis screen reader keyboard'],
  ['session','session-controls','Privacy screen lock close applications'],
  ['privacy','permissions','Camera microphone screen browser permissions activity stop'],
  ['privacy','data-controls','Account sync data clear caches history delete recovery drafts'],
  ['privacy','connected-services','Remote Terminal Chromium cookies profile analytics data storage'],
  ['profile','profile','Profile display name accounts identity sign in'],
  ['weather','weather-location','Manual city location weather permission'],
  ['applications','defaults','Default applications file link associations permissions'],
] as const;
