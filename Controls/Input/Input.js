/// <container name="Fit.Controls.Input" extends="Fit.Controls.ControlBase">
/// 	Input control which allows for one or multiple lines of
/// 	text, and features a Design Mode for rich HTML content.
/// 	Extending from Fit.Controls.ControlBase.
/// </container>

/// <function container="Fit.Controls.Input" name="Input" access="public">
/// 	<description> Create instance of Input control </description>
/// 	<param name="ctlId" type="string" default="undefined"> Unique control ID that can be used to access control using Fit.Controls.Find(..) </param>
/// </function>
Fit.Controls.Input = function(ctlId)
{
	Fit.Validation.ExpectStringValue(ctlId, true);
	Fit.Core.Extend(this, Fit.Controls.ControlBase).Apply(ctlId);

	var me = this;
	var orgVal = "";			// Holds initial value used to determine IsDirty state
	var preVal = "";			// Holds latest change made by user - used to determine whether OnChange needs to be fired
	var input = null;
	var changeObserverId = -1;	// Holds interval ID to observer function for controls (e.g. color picker) not continuously firing OnChange when value is changed
	var cmdResize = null;
	var designEditor = null;
	var designEditorDom = null; // DOM elements within CKEditor which we rely on - some <div> elements become <span> elements in older browsers
	/*{
		OuterContainer: null,	// <div class="cke">
		InnerContainer: null,	//     <div class="cke_inner">
		Top: null,				//         <span class="cke_top">
		Content: null,			//         <div class="cke_contents">
		Editable: null,			//             <div class="cke_editable">
		Bottom: null			//         <span class="cke_bottom">
	}*/
	var designEditorDirty = false;
	var designEditorDirtyPending = false;
	var designEditorConfig = null;
	var designEditorReloadConfig = null;
	var designEditorRestoreButtonState = null;
	var designEditorSuppressPaste = false;
	var designEditorSuppressOnResize = false;
	var designEditorMustReloadWhenReady = false;
	var designEditorMustDisposeWhenReady = false;
	var designEditorUpdateSizeDebouncer = -1;
	var designEditorHeightMonitorId = -1;
	var designEditorActiveToolbarPanel = null; // { DomElement: HTMLElement, UnlockFocusStateIfEmojiPanelIsClosed: function, CloseEmojiPanel: function }
	var designEditorDetached = null; // { IsActive: boolean, GetValue: function, SetVisible: function, SetEnabled: function, Focus: function, Reload: function, Open: function, Close: function, Dispose: function }
	var designEditorClearPlaceholder = true;
	var designEditorCleanEditableDom = false;
	var designEditorGlobalKeyDownEventId = -1;
	var designEditorGlobalKeyUpEventId = -1;
	//var htmlWrappedInParagraph = false;
	var wasAutoChangedToMultiLineMode = false; // Used to revert to single line if multi line was automatically enabled along with DesignMode(true), Maximizable(true), or Resizable(true)
	var minimizeHeight = -1;
	var maximizeHeight = -1;
	var minMaxUnit = null;
	var maximizeHeightConfigured = -1;
	var resizable = Fit.Controls.InputResizing.Disabled;
	var nativeResizableAvailable = false; // Updated in init()
	var mutationObserverId = -1;		// Specific to DesignMode
	var rootedEventId = -1;				// Specific to DesignMode
	var createWhenReadyIntervalId = -1;	// Specific to DesignMode
	var isIe8 = (Fit.Browser.GetInfo().Name === "MSIE" && Fit.Browser.GetInfo().Version === 8);
	var debounceOnChangeTimeout = -1;
	var debouncedOnChange = null;
	var imageBlobUrls = [];				// Specific to DesignMode
	var locale = null;

	// ============================================
	// Init
	// ============================================

	function init()
	{
		input = document.createElement("input");
		input.type = "text";
		input.autocomplete = "off";
		input.spellcheck = true;
		input.onkeyup = function()
		{
			if (designEditorClearPlaceholder === true)
			{
				designEditorClearPlaceholder = false;	// Prevent additional calls to updateDesignEditorPlaceholder - it retrieves editor value which is expensive
				updateDesignEditorPlaceholder(true);	// Clear placeholder
			}

			if (debounceOnChangeTimeout === -1)
			{
				fireOnChange();
			}
			else
			{
				if (debouncedOnChange === null)
				{
					debouncedOnChange = Fit.Core.CreateDebouncer(fireOnChange, debounceOnChangeTimeout);
				}

				debouncedOnChange.Invoke();
			}

			if (me.Maximizable() === true)
			{
				// Scroll to bottom if nearby, to make sure text does not collide with maximize button.
				// Extra padding-bottom is added inside control to allow for spacing between text and maximize button.

				var scrollContainer = designEditorDom && designEditorDom.Editable || input;
				var autoScrollToBottom = scrollContainer.scrollTop + scrollContainer.clientHeight > scrollContainer.scrollHeight - 15; // True when at bottom or very close (15px buffer)

				if (autoScrollToBottom === true)
				{
					scrollContainer.scrollTop += 99;
				}
			}
		}
		input.onchange = function() // OnKeyUp does not catch changes by mouse (e.g. paste or moving selected text)
		{
			if (me === null)
			{
				// Fix for Chrome which fires OnChange and OnBlur (in both capturering and bubbling phase)
				// if control has focus while being removed from DOM, e.g. if used in a dialog closed using ESC.
				// More details here: https://bugs.chromium.org/p/chromium/issues/detail?id=866242
				return;
			}

			input.onkeyup();
		}
		me._internal.AddDomElement(input);

		me.AddCssClass("FitUiControlInput");

		me._internal.Data("multiline", "false");
		me._internal.Data("maximizable", "false");
		me._internal.Data("maximized", "false");
		me._internal.Data("resizable", resizable.toLowerCase());
		me._internal.Data("resized", "false");
		me._internal.Data("designmode", "false");

		Fit.Internationalization.OnLocaleChanged(localize);
		localize();

		me.OnBlur(function(sender)
		{
			hideToolbarInDesignMode(); // Hide toolbar if configured to do so

			// Due to CKEditor and plugins allowing for inconsistency between what is being
			// pushed via OnChange and the editor's actual value, we ensure that the latest
			// and actual value is pushed via Input.OnChange when the control lose focus.
			// See related bug report for CKEditor here: https://github.com/ckeditor/ckeditor4/issues/4856

			if (debouncedOnChange !== null)
			{
				debouncedOnChange.Cancel(); // Do not trigger fireOnChange twice (below) if currently scheduled for execution
			}

			fireOnChange(); // Only fires OnChange if value has actually changed
		});

		me.OnFocus(function(sender)
		{
			restoreHiddenToolbarInDesignEditor();	// Make toolbar appear if currently hidden
			//updateDesignEditorPlaceholder(true);	// Clear placeholder text

			if (me.Type() === "Color") // Color picker does not continuously fire OnChange when changing color - fix that using an observer function
			{
				changeObserverId = setInterval(function()
				{
					input.onkeyup();
				}, 100);
			}
		});
		me.OnBlur(function(sender)
		{
			restoreDesignEditorButtons();			// Restore (enable) editor's toolbar buttons in case they were temporarily disabled
			updateDesignEditorPlaceholder();		// Show placeholder text if control value is empty

			if (changeObserverId !== -1)
			{
				clearInterval(changeObserverId);
				changeObserverId = -1;
			}
		});

		Fit.Events.AddHandler(me.GetDomElement(), "paste", true, function(e)
		{
			if (me.DesignMode() === true && designEditorSuppressPaste === true)
			{
				Fit.Events.Stop(e);
			}
		});

		// Suppress CKEditor's ContextMenu to open the browser's own ContextMenu,
		// unless right-clicking in a table, in which case we need access to the table tools.
		Fit.Events.AddHandler(me.GetDomElement(), "contextmenu", true, function(e) // Capture phase (true argument) not supported by IE8 - too bad, IE8 users will have to use the browser's Edit menu at the top to cut/copy/paste
		{
			if (me.DesignMode() === true)
			{
				var ev = Fit.Events.GetEvent(e);
				var target = Fit.Events.GetTarget(ev);

				if (isTable(target) === false)
				{
					Fit.Events.StopPropagation(ev); // Suppress CKEditor's context menu (required by the table plugin)
				}
			}
		});
		Fit.Events.AddHandler(me.GetDomElement(), "keydown", true, function(e) // Capture phase (true argument) not supported by IE8
		{
			if (me.DesignMode() === true)
			{
				var ev = Fit.Events.GetEvent(e);

				if ((ev.shiftKey === true && ev.keyCode === 121) || ev.keyCode === 93) // SHIFT + F10 or Windows ContextMenu key
				{
					Fit.Events.StopPropagation(ev); // Suppress CKEditor's context menu (required by the table plugin)
				}
			}
		});

		try
		{
			// We rely on the .buttons property to optimize resizing for textarea (MultiLine mode).
			// The MouseEvent class might not be available on older browsers or might throw an exception when constructing.
			nativeResizableAvailable = window.MouseEvent && new MouseEvent("mousemove", {}).buttons !== undefined || false;
		}
		catch (err) {}
	}

	// ============================================
	// Public - overrides
	// ============================================

	// See documentation on ControlBase
	this.Visible = Fit.Core.CreateOverride(this.Visible, function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) && designEditorDetached !== null)
		{
			designEditorDetached.SetVisible(val);
		}

		return base(val);
	});

	// See documentation on ControlBase
	this.Enabled = function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) === true && val !== me.Enabled())
		{
			me._internal.Data("enabled", val === true ? "true" : "false");

			if (val === false)
			{
				me.Focused(false);
			}

			input.disabled = val === false;

			if (designModeEnabledAndReady() === true) // ReadOnly mode will be set when instance is ready, if not ready at this time
			{
				designEditor.setReadOnly(input.disabled);

				// Set tabindex to allow or disallow focus. Unfortunately there is no editor API for changing the tabindex.
				// Preventing focus is only possible by nullifying DOM attribute (these does not work: delete elm.tabIndex; elm.tabIndex = null|undefined|-1).
				Fit.Dom.Attribute(designEditorDom.Editable, "tabindex", input.disabled === true ? null : "0");

				// Prevent control from losing focus when HTML editor is initialized,
				// e.g. if Design Mode is enabled when ordinary input control gains focus.
				// This also prevents control from losing focus if toolbar is clicked without
				// hitting a button. A value of -1 makes it focusable, but keeps it out of
				// tab flow (keyboard navigation). Also set when DesignMode(true) is called.
				Fit.Dom.Attribute(me.GetDomElement(), "tabindex", input.disabled !== true && me.DesignMode() === true ? "-1" : null); // Remove tabindex used to prevent control from losing focus when clicking toolbar buttons, as it will allow control to gain focus when clicked using the mouse
			}

			if (designEditorDetached !== null)
			{
				designEditorDetached.SetEnabled(val);
			}

			me._internal.UpdateInternalState();
			me._internal.Repaint();
		}

		return me._internal.Data("enabled") === "true";
	}

	// See documentation on ControlBase
	this.Focused = function(focus)
	{
		Fit.Validation.ExpectBoolean(focus, true);

		if (designEditorDetached !== null && designEditorDetached.IsActive === true)
		{
			if (focus === true)
			{
				designEditorDetached.Focus();
			}
			else if (focus === false)
			{
				Fit.Browser.Debug("WARNING: Unable to remove focus from Input control '" + me.GetId() + "' when modal detached editor is open");
			}

			return me.Visible(); // Always considered focused if detached editor is open and control (along with detached editor) is visible
			//return designEditorDetached.GetFocused();
		}

		elm = input;

		if (me.DesignMode() === true)
		{
			if (designModeEnabledAndReady() === true)
			{
				elm = designEditor; // Notice: designEditor is an instance of CKEditor, not a DOM element, but it does expose a focus() function
			}
			else
			{
				elm = me.GetDomElement(); // Editor not loaded yet - focus control container temporarily - focus is later moved to editable area once instanceReady handler is invoked
			}
		}

		if (Fit.Validation.IsSet(focus) === true)
		{
			if (focus === true)
			{
				if (Fit._internal.Controls.Input.ActiveEditorForDialog === me)
				{
					// Remove flag used to auto close editor dialog, in case Focused(false)
					// was called followed by Focused(true), while editor dialog was loading.
					delete Fit._internal.Controls.Input.ActiveDialogForEditorCanceled;
				}

				elm.focus();
			}
			else // Remove focus
			{
				if (designModeEnabledAndReady() === true)
				{
					if (Fit._internal.Controls.Input.ActiveEditorForDialog === me)
					{
						if (Fit._internal.Controls.Input.ActiveDialogForEditor !== null)
						{
							// A dialog (e.g. link or image dialog) is currently open, and will now be closed

							// Hide dialog - fires dialog's OnHide event and returns focus to editor
							Fit._internal.Controls.Input.ActiveDialogForEditor.hide();

							// CKEditor instance has no blur() function, so we call blur() on DOM element currently focused within CKEditor
							Fit.Dom.GetFocused().blur();

							// Fire OnBlur manually as blur() above didn't trigger this, as it normally
							// would. The call to the dialog's hide() function fires its OnHide event
							// which disables the focus lock, but does so asynchronously, which is
							// why OnBlur does not fire via ControlBase's onfocusout handler.
							me._internal.FireOnBlur();
						}
						else
						{
							// A dialog (e.g. link or image dialog) is currently loading. This situation
							// can be triggered for debugging purposes by adding the following code in the
							// beforeCommandExec event handler:
							// setTimeout(function() { me.Focused(false); }, 0);
							// Alternatively register an onwheel/onscroll handler on the document that
							// removes focus from the control, and quickly scroll the document while the
							// dialog is loading. Use network throttling to increase the load time of the
							// dialog if necessary.

							// Make dialog close automatically when loaded and shown - handled in dialog's OnShow event handler
							Fit._internal.Controls.Input.ActiveDialogForEditorCanceled = true;

							// CKEditor instance has no blur() function, so we call blur() on DOM element currently focused within CKEditor.
							// Notice that OnBlur does not fire immediately (focus state is locked), but does so when dialog's OnHide event fires (async).
							// While we could fire it immediately and prevent it from firing when the dialog's OnHide event fires, it would prevent
							// developers from using the OnBlur event to dispose a control in Design Mode, since CKEditor fails when being disposed
							// while dialogs are open. Focused() will return False after the call to blur() below though - as expected.
							Fit.Dom.GetFocused().blur();
						}
					}
					else
					{
						if (designEditorActiveToolbarPanel !== null)
						{
							designEditorActiveToolbarPanel.CloseEmojiPanel(); // Returns focus to editor and nullifies designEditorActiveToolbarPanel
						}

						// Make sure this control is focused so that one control instance can not
						// be used to accidentially remove focus from another control instance.
						if (Fit.Dom.Contained(me.GetDomElement(), Fit.Dom.GetFocused()) === true)
						{
							// CKEditor instance has no blur() function, so we call blur() on DOM element currently focused within CKEditor
							Fit.Dom.GetFocused().blur();
						}
					}
				}
				else
				{
					elm.blur();
				}
			}
		}

		// Guard against disposed control in case Focused(false) was called and an OnBlur handler disposed the control.
		// As the code further up shows, we call me._internal.FireOnBlur() if a dialog is currently open. This results
		// in OnBlur firing immediately, while normally it happens asynchronously due to how OnFocus and OnBlur is handled
		// in ControlBase, in which case we do not need to worry that the control might be disposed. It happens "later".
		// The situation can easily arise if an OnScroll handler is reponsible for removing focus from a control,
		// and if that control also has an OnBlur handler registered which disposes the control. Scrolling with a
		// dialog open will then trigger the situation which we guard against here.
		if (me === null)
		{
			return false;
		}

		if (me.DesignMode() === true)
		{
			// If a dialog is open and it belongs to this control instance, and focus is found within dialog, then control is considered having focus.
			// However, if <body> is focused while dialog is open, control is also considered to have focus, since dialog temporarily assigns focus to
			// <body> when tabbing between elements within the dialog. This seems safe as no other control can be considered focused if <body> has focus.
			// We also consider the control focused if an associated dialog (modal) is currently loading (Fit._internal.Controls.Input.ActiveDialogForEditor is null).
			if (Fit._internal.Controls.Input.ActiveEditorForDialog === me && (Fit._internal.Controls.Input.ActiveDialogForEditor === null || Fit.Dom.Contained(Fit._internal.Controls.Input.ActiveDialogForEditor.getElement().$, Fit.Dom.GetFocused()) === true || Fit.Dom.GetFocused() === document.body))
				return true;

			// If a toolbar dialog/callout is open and contains the element currently having focus, then control is considered having focus.
			// If the dialog/callout contains an iframe in which an element has focus, then the iframe is considered focused in the main window.
			if (designEditorActiveToolbarPanel !== null && Fit.Dom.Contained(designEditorActiveToolbarPanel.DomElement, Fit.Dom.GetFocused()) === true)
				return true;

			return Fit.Dom.GetFocused() === me.GetDomElement() || Fit.Dom.Contained(me.GetDomElement(), Fit.Dom.GetFocused());
		}

		return (Fit.Dom.GetFocused() === elm);
	}

	// See documentation on ControlBase
	this.Value = function(val, preserveDirtyState)
	{
		Fit.Validation.ExpectString(val, true);
		Fit.Validation.ExpectBoolean(preserveDirtyState, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			val = me.Type() === "Color" ? val.toUpperCase() : val;

			var fireOnChange = (me.Value() !== val);

			orgVal = (preserveDirtyState !== true ? val : orgVal);
			preVal = val;
			designEditorDirty = designEditorDirtyPending === true ? true : false;
			designEditorDirtyPending = false;

			/*if (val.indexOf("<p>") === 0)
				htmlWrappedInParagraph = true; // Indicates that val is comparable with value from CKEditor which wraps content in paragraphs*/

			if (designModeEnabledAndReady() === true)
			{
				// NOTICE: Invalid HTML is removed, so an all invalid HTML string will be discarded
				// by the editor, resulting in the editor's getData() function returning an empty string.

				// Calling setData(..) fires CKEditor's onchange event which in turn fires
				// Input's OnChange event. Suppress OnChange which is fired further down.
				me._internal.ExecuteWithNoOnChange(function()
				{
					designEditorCleanEditableDom = true;
					CKEDITOR.instances[me.GetId() + "_DesignMode"].setData(val);
					designEditorCleanEditableDom = false;
				});

				updateDesignEditorPlaceholder();
				updateDesignEditorSize(); // In case auto grow is enabled, in which case editor must adjust its height to its new content
			}
			else
			{
				input.value = val;
			}

			// Notice: Identical logic is NOT found in DesignMode(true, config) as with RevokeExternalBlobUrlsOnDispose below.
			// When the RevokeUnreferencedBlobUrlsOnValueSet mechanism is in play, the control has already been used as an HTML editor
			// before, as we are expecting the control to be re(-used) to manipulate different values. In this case we already have
			// designEditorConfig available, although it could theoretically be changed over time so RevokeUnreferencedBlobUrlsOnValueSet
			// is sometimes enabled and sometimes not - but we don't care to support poor design like this:
			// input.DesignMode(true, configWithRevokeUnreferencedBlobUrlsOnValueSetDISBLED);
			// input.Value("New HTML value");
			// input.DesignMode(true, configWithRevokeUnreferencedBlobUrlsOnValueSetENABLED); // This will not clean up image blobs no longer referenced
			if (designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.RevokeUnreferencedBlobUrlsOnValueSet === true)
			{
				// Remove image blobs from memory when a new value is set, unless some (or all)
				// of these image blobs are still referenced in the new value, of course.
				// This is useful if an editor instance is being (re-)used to modify different values.
				// NOTICE: There is a major memory leak in CKEditor related to bulk pasting images
				// from the file system, and the last image pasted always remains in memory:
				// https://github.com/ckeditor/ckeditor4/issues/5124

				var blobUrlsReferenced = Fit.String.ParseImageBlobUrls(val);
				var newImageBlobUrls = [];

				Fit.Array.ForEach(imageBlobUrls, function(blobUrl)
				{
					if (Fit.Array.Contains(blobUrlsReferenced, blobUrl) === true)
					{
						newImageBlobUrls.push(blobUrl); // Keep - still referenced in new value
					}
					else
					{
						URL.revokeObjectURL(blobUrl); // Revoke - no longer referenced in new value
					}
				});

				imageBlobUrls = newImageBlobUrls;
			}

			// Notice: Identical logic found in DesignMode(true, config)!
			if (designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.RevokeExternalBlobUrlsOnDispose === true)
			{
				// Keep track of image blobs added via Value(..) so we can dispose of them automatically.
				// When RevokeExternalBlobUrlsOnDispose is True it basically means that the Input control
				// is allowed (and expected) to take control over memory management for these blobs
				// based on the rule set in RevokeBlobUrlsOnDispose.
				// This code is also found in DesignMode(true, config) since images might be added before
				// DesignMode is enabled, in which case we do not yet have the editor configuration needed
				// to determine the desired behaviour.
				// NOTICE: There is a major memory leak in CKEditor related to bulk pasting images
				// from the file system, and the last image pasted always remains in memory:
				// https://github.com/ckeditor/ckeditor4/issues/5124

				var blobUrls = Fit.String.ParseImageBlobUrls(val);

				Fit.Array.ForEach(blobUrls, function(blobUrl)
				{
					if (Fit.Array.Contains(imageBlobUrls, blobUrl) === false)
					{
						Fit.Array.Add(imageBlobUrls, blobUrl);
					}
				});
			}

			if (fireOnChange === true)
				me._internal.FireOnChange();
		}

		if (designModeEnabledAndReady() === true)
		{
			// If user has not changed value, then return the value initially set.
			// CKEditor may change (optimize) HTML when applied, but we always want
			// the value initially set when no changes have been made by the user.
			// See additional comments regarding this in the IsDirty() implementation.
			if (designEditorDirty === false)
			{
				return orgVal;
			}

			var curVal = CKEDITOR.instances[me.GetId() + "_DesignMode"].getData();

			// Remove extra line break added by htmlwriter plugin at the end: <p>Hello world</p>\n
			curVal = curVal.replace(/<\/p>\n$/, "</p>");

			// Remove empty class attribute on <img> tags which may be temporarily set when selecting
			// an image using the dragresize plugin. This plugin adds a CSS class (ckimgrsz) to the image
			// tag while being selected, although the class name is removed when calling getData() above.
			// However, the empty class attribute is useless, so we remove it. It also results in IsDirty()
			// returning True while the image is selected if we keep it. Actually the class attribute should
			// never have been returned since the allowedContent option does not allow it - might be a minor bug.
			curVal = curVal.replace(/(<img.*?) class=""(.*?>)/, "$1$2"); // Not using /g switch as only one image can be selected

			return curVal;
		}

		return me.Type() === "Color" ? input.value.toUpperCase() : input.value;
	}

	// See documentation on ControlBase
	this.UserValue = Fit.Core.CreateOverride(this.UserValue, function(val)
	{
		if (Fit.Validation.IsSet(val) === true && me.DesignMode() === true)
		{
			designEditorDirtyPending = true;
		}

		return base(val);
	});

	// See documentation on ControlBase
	this.IsDirty = function()
	{
		if (me.DesignMode() === true)
		{
			// Never do value comparison in DesignMode.
			// A value such as "Hello world" could have been provided,
			// which by CKEditor would be returned as "<p>Hello world</p>".
			// A value such as '<p style="text-align: center;">Hello</p>' could
			// also have been set, which by CKEditor would be optimized to
			// '<p style="text-align:center">Hello</p>' via ACF (Advanced Content Filter):
			// https://ckeditor.com/docs/ckeditor4/latest/guide/dev_advanced_content_filter.html
			// Furthermore invalid HTML is removed while valid HTML is kept.
			// All this makes it very difficult to reliably determine dirty state
			// by comparing values. Therefore, if the user changed anything by interacting
			// with the editor, or UserValue(..) was called, always consider the value dirty.

			// Another positive of avoiding value comparison to determine dirty state
			// is that retrieving the value from CKEditor is fairly expensive.

			return designEditorDirty;
		}

		return (orgVal !== me.Value());
	}

	// See documentation on ControlBase
	this.Clear = function()
	{
		me.Value("");
	}

	// See documentation on ControlBase
	this.Dispose = Fit.Core.CreateOverride(this.Dispose, function()
	{
		// This will destroy control - it will no longer work!

		if (me.DesignMode() === true && designModeEnabledAndReady() === false) // DesignMode is enabled but editor is not done loading/initializing
		{
			// WARNING: This has the potential to leak memory if editor never loads and resumes task of disposing control!
			designEditorMustDisposeWhenReady = true;

			// Editor was disposed while loading/initializing.
			// Postpone destruction of control to make sure we can clean up resources
			// reliably once editor is ready. We know that CKEditor does not dispose properly
			// unless fully loaded (it may leave an instance on the global CKEDITOR object or even fail).
			Fit.Browser.Debug("WARNING: Attempting to dispose Input control '" + me.GetId() + "' while initializing DesignMode! Control will be disposed later.");

			// Do not keep control in user interface when disposed.
			// Mount control in document root and move it off screen (outside visible
			// viewport area). CKEditor will fail initialization if not mounted in DOM.
			me.Render(document.body);
			me.GetDomElement().style.position = "fixed";
			me.GetDomElement().style.left = "0px";
			me.GetDomElement().style.bottom = "-100px";
			me.GetDomElement().style.maxHeight = "100px";

			// Detect memory leak
			/* setTimeout(function()
			{
				if (me !== null)
				{
					Fit.Browser.Debug("WARNING: Input in DesignMode was not properly disposed in time - potential memory leak detected");
				}
			}, 5000); // Usually the load time for an editor is barely measurable, so 5 seconds seems sufficient */

			return;
		}

		var curVal = designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.RevokeBlobUrlsOnDispose === "UnreferencedOnly" ? me.Value() : null;

		if (Fit._internal.Controls.Input.ActiveEditorForDialog === me)
		{
			if (Fit._internal.Controls.Input.ActiveDialogForEditor === null)
			{
				// Dialog is currently loading.
				// CKEditor will throw an error if disposed while a dialog (e.g. the link dialog) is loading,
				// leaving a modal layer on the page behind, making it unusable. This may happen if disposed
				// from e.g. a DOM event handler, a mutation observer, a timer, or an AJAX request. The input control
				// itself does not fire any events while the dialog is loading which could trigger this situation, so
				// this can only happen from "external code".

				// WARNING: This has the potential to leak memory if dialog never loads and resumes task of disposing control!
				Fit._internal.Controls.Input.ActiveEditorForDialogDestroyed = designEditor;
				Fit.Dom.Remove(me.GetDomElement());

				// Detect memory leak
				/* setTimeout(function()
				{
					if (me !== null)
					{
						Fit.Browser.Log("WARNING: Input in DesignMode was not properly disposed in time - potential memory leak detected");
					}
				}, 5000); // Usually the load time for a dialog is barely measurable, so 5 seconds seems sufficient */

				return;
			}
			else
			{
				Fit._internal.Controls.Input.ActiveDialogForEditor.hide(); // Fires dialog's OnHide event
			}
		}

		if (designEditor !== null)
		{
			// Destroying editor also fires OnHide event for any dialog currently open, which will clean up
			// Fit._internal.Controls.Input.ActiveEditorForDialog;
			// Fit._internal.Controls.Input.ActiveEditorForDialogDestroyed;
			// Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed;
			// Fit._internal.Controls.Input.ActiveDialogForEditor;
			// Fit._internal.Controls.Input.ActiveDialogForEditorCanceled;

			destroyDesignEditorInstance(); // Destroys editor and stops related mutation observers, timers, etc.
		}

		if (changeObserverId !== -1)
		{
			clearInterval(changeObserverId);
		}

		Fit.Internationalization.RemoveOnLocaleChanged(localize);

		/*if (designEditorUpdateSizeDebouncer !== -1)
		{
			clearTimeout(designEditorUpdateSizeDebouncer);
		}

		if (mutationObserverId !== -1)
		{
			Fit.Events.RemoveMutationObserver(mutationObserverId);
		}

		if (rootedEventId !== -1)
		{
			Fit.Events.RemoveHandler(me.GetDomElement(), rootedEventId);
		}

		if (createWhenReadyIntervalId !== -1)
		{
			clearInterval(createWhenReadyIntervalId);
		}*/

		if (debouncedOnChange !== null)
		{
			debouncedOnChange.Cancel();
		}

		if (designEditorConfig === null || !designEditorConfig.Plugins || !designEditorConfig.Plugins.Images || !designEditorConfig.Plugins.Images.RevokeBlobUrlsOnDispose || designEditorConfig.Plugins.Images.RevokeBlobUrlsOnDispose === "All")
		{
			Fit.Array.ForEach(imageBlobUrls, function(imageUrl)
			{
				URL.revokeObjectURL(imageUrl);
			});
		}
		else // UnreferencedOnly
		{
			Fit.Array.ForEach(imageBlobUrls, function(imageUrl)
			{
				if (curVal.match(new RegExp("img.*src=([\"'])" + imageUrl + "\\1", "i")) === null)
				{
					URL.revokeObjectURL(imageUrl);
				}
			});
		}

		me = orgVal = preVal = input = changeObserverId = cmdResize = designEditor = designEditorDom = designEditorDirty = designEditorDirtyPending = designEditorConfig = designEditorReloadConfig = designEditorRestoreButtonState = designEditorSuppressPaste = designEditorSuppressOnResize = designEditorMustReloadWhenReady = designEditorMustDisposeWhenReady = designEditorUpdateSizeDebouncer = designEditorHeightMonitorId = designEditorActiveToolbarPanel = designEditorDetached = designEditorClearPlaceholder = designEditorCleanEditableDom = designEditorGlobalKeyDownEventId = designEditorGlobalKeyUpEventId /*= htmlWrappedInParagraph*/ = wasAutoChangedToMultiLineMode = minimizeHeight = maximizeHeight = minMaxUnit = maximizeHeightConfigured = resizable = nativeResizableAvailable = mutationObserverId = rootedEventId = createWhenReadyIntervalId = isIe8 = debounceOnChangeTimeout = debouncedOnChange = imageBlobUrls = locale = null;

		base();
	});

	// See documentation on ControlBase
	this.Width = Fit.Core.CreateOverride(this.Width, function(val, unit)
	{
		Fit.Validation.ExpectNumber(val, true);
		Fit.Validation.ExpectStringValue(unit, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			me._internal.Data("resized", "false");

			base(val, unit);
			updateDesignEditorSize();
		}

		return base();
	});

	// See documentation on ControlBase
	this.Height = Fit.Core.CreateOverride(this.Height, function(val, unit, suppressMinMax)
	{
		Fit.Validation.ExpectNumber(val, true);
		Fit.Validation.ExpectStringValue(unit, true);
		Fit.Validation.ExpectBoolean(suppressMinMax, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			// Restore/minimize control if currently maximized
			if (me.Maximizable() === true && suppressMinMax !== true)
			{
				me.Maximized(false);
			}

			me._internal.Data("resized", "false");
			me._internal.Data("autogrow", me.DesignMode() === true ? "false" : null);

			var autoGrowEnabled = false;
			if (val === -1 && designModeEnabledAndReady() === true) // Enable auto grow if editor is loaded and ready - otherwise enabled in instanceReady handler
			{
				// A value of -1 is used to reset control height (assume default height).
				// In DesignMode we want the control height to adjust to the content of the editor in this case.
				// The editor's ability to adjust to the HTML content is handled in updateDesignEditorSize() below.
				// Auto grow can also be enabled using configuration object passed to DesignMode(true, config).
				me._internal.Data("autogrow", "true"); // Make control container adjust to editor's height
				autoGrowEnabled = true;
			}

			// Enable support for relative height if editor is loaded and ready - otherwise enabled in instanceReady handler
			enableDesignEditorHeightMonitor(val !== -1 && unit === "%" && designModeEnabledAndReady() === true);

			var hideToolbarAgain = false;
			if (isToolbarHiddenInDesignEditor() === true)
			{
				// If in DesignMode, temporarily restore toolbar to allow update to height.
				// When toolbar is hidden, a fixed height is set on the editable area which
				// prevent changes to control height.
				restoreHiddenToolbarInDesignEditor();
				hideToolbarAgain = true;
			}

			var h = base(val, unit);
			updateDesignEditorSize();

			if (hideToolbarAgain === true)
			{
				hideToolbarInDesignMode();
			}

			// Calculate new maximize height if control is maximizable
			if (me.Maximizable() === true && suppressMinMax !== true)
			{
				minimizeHeight = h.Value;
				maximizeHeight = (maximizeHeightConfigured !== -1 ? maximizeHeightConfigured : (minimizeHeight !== -1 ? minimizeHeight * 2 : 300));
				minMaxUnit = h.Unit;
			}

			if (autoGrowEnabled === true) // Repaint in case auto grow was enabled above
			{
				repaint();
			}
		}

		return base();
	});

	// ============================================
	// Public
	// ============================================

	/// <function container="Fit.Controls.Input" name="Placeholder" access="public" returns="string">
	/// 	<description> Get/set value used as a placeholder to indicate expected input on supported browsers </description>
	/// 	<param name="val" type="string" default="undefined"> If defined, value is set as placeholder </param>
	/// </function>
	this.Placeholder = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			input.placeholder = val;
			updateDesignEditorPlaceholder();
		}

		return (input.placeholder ? input.placeholder : "");
	}

	/// <function container="Fit.Controls.Input" name="CheckSpelling" access="public" returns="boolean">
	/// 	<description> Get/set value indicating whether control should have spell checking enabled (default) or disabled </description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, true enables spell checking while false disables it </param>
	/// </function>
	this.CheckSpelling = function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			if (val !== input.spellcheck)
			{
				input.spellcheck = val;

				if (me.DesignMode() === true)
				{
					reloadEditor();
				}
			}
		}

		return input.spellcheck;
	}

	/// <function container="Fit.Controls.Input" name="Type" access="public" returns="Fit.Controls.InputType">
	/// 	<description> Get/set input type (e.g. Text, Password, Email, etc.) </description>
	/// 	<param name="val" type="Fit.Controls.InputType" default="undefined"> If defined, input type is changed to specified value </param>
	/// </function>
	this.Type = function(val)
	{
		Fit.Validation.ExpectStringValue(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			if (Fit.Validation.IsSet(Fit.Controls.InputType[val]) === false || val === Fit.Controls.InputType.Unknown)
				Fit.Validation.ThrowError("Unsupported input type specified - use e.g. Fit.Controls.InputType.Text");

			if (val === Fit.Controls.InputType.Textarea)
			{
				me.MultiLine(true);
			}
			else
			{
				me.MultiLine(false);

				if (val === Fit.Controls.InputType.Color)
					input.type = "color";
				else if (val === Fit.Controls.InputType.Date)
					input.type = "date";
				else if (val === Fit.Controls.InputType.DateTime)
					input.type = "datetime";
				else if (val === Fit.Controls.InputType.Email)
					input.type = "email";
				else if (val === Fit.Controls.InputType.Month)
					input.type = "month";
				else if (val === Fit.Controls.InputType.Number)
					input.type = "number";
				else if (val === Fit.Controls.InputType.Password)
					input.type = "password";
				else if (val === Fit.Controls.InputType.PhoneNumber)
					input.type = "tel";
				else if (val === Fit.Controls.InputType.Text)
					input.type = "text";
				else if (val === Fit.Controls.InputType.Time)
					input.type = "time";
				else if (val === Fit.Controls.InputType.Week)
					input.type = "week";
			}
		}

		if (me.MultiLine() === true || me.DesignMode() === true)
			return Fit.Controls.InputType.Textarea;
		else if (input.type === "color")
			return Fit.Controls.InputType.Color;
		else if (input.type === "date")
			return Fit.Controls.InputType.Date;
		else if (input.type === "datetime")
			return Fit.Controls.InputType.DateTime;
		else if (input.type === "email")
			return Fit.Controls.InputType.Email;
		else if (input.type === "month")
			return Fit.Controls.InputType.Month;
		else if (input.type === "number")
			return Fit.Controls.InputType.Number;
		else if (input.type === "password")
			return Fit.Controls.InputType.Password;
		else if (input.type === "tel")
			return Fit.Controls.InputType.PhoneNumber;
		else if (input.type === "text")
			return Fit.Controls.InputType.Text;
		else if (input.type === "time")
			return Fit.Controls.InputType.Time;
		else if (input.type === "week")
			return Fit.Controls.InputType.Week;

		return Fit.Controls.InputType.Unknown; // Only happens if someone changed the type to an unsupported value through the DOM (e.g. hidden or checkbox)
	}

	/// <function container="Fit.Controls.Input" name="MultiLine" access="public" returns="boolean">
	/// 	<description> Get/set value indicating whether control is in Multi Line mode (textarea) </description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, True enables Multi Line mode, False disables it </param>
	/// </function>
	this.MultiLine = function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			if (me.DesignMode() === true && designModeEnabledAndReady() === false)
			{
				console.error("MultiLine(boolean) is not allowed for Input control '" + me.GetId() + "' while DesignMode editor is initializing!");
				return false; // Return current un-modified state - Input control is not in MultiLine mode when DesignMode is enabled
			}

			if (me.DesignMode() === true)
				me.DesignMode(false);

			if (val === true && wasAutoChangedToMultiLineMode === true)
			{
				wasAutoChangedToMultiLineMode = false;
			}

			if (val === true && input.tagName === "INPUT")
			{
				var focused = me.Focused();

				var oldInput = input;
				me._internal.RemoveDomElement(oldInput);

				input = document.createElement("textarea");
				input.value = oldInput.value;
				input.spellcheck = oldInput.spellcheck;
				input.placeholder = oldInput.placeholder;
				input.disabled = oldInput.disabled;
				input.onkeyup = oldInput.onkeyup;
				input.onchange = oldInput.onchange;
				me._internal.AddDomElement(input);

				if (nativeResizableAvailable === true)
				{
					Fit.Events.AddHandler(input, "mousemove", function(e)
					{
						var ev = Fit.Events.GetEvent(e);

						if (ev.buttons !== 1) // The .buttons property does not exist in older browsers (see nativeResizableAvailable)
						{
							return; // Skip - primary button not held down - not resizing
						}

						if (me.Resizable() !== Fit.Controls.InputResizing.Disabled && (input.style.width !== "" || input.style.height !== "")) // Textarea was resized
						{
							me._internal.Data("resized", "true");
						}
					});
				}

				if (focused === true)
					input.focus();

				me._internal.Data("multiline", "true");
				repaint();
			}
			else if (val === false && input.tagName === "TEXTAREA")
			{
				var focused = me.Focused();

				var oldInput = input;
				me._internal.RemoveDomElement(oldInput);

				if (cmdResize !== null)
				{
					me._internal.RemoveDomElement(cmdResize);
					cmdResize = null;

					me._internal.Data("maximized", "false");
					me._internal.Data("maximizable", "false");
					repaint();
				}
				else if (resizable !== Fit.Controls.InputResizing.Disabled)
				{
					resizable = Fit.Controls.InputResizing.Disabled;
					me._internal.Data("resizable", resizable.toLowerCase());
					me._internal.Data("resized", "false");
				}

				input = document.createElement("input");
				input.autocomplete = "off";
				input.type = "text";
				input.value = oldInput.value;
				input.spellcheck = oldInput.spellcheck;
				input.placeholder = oldInput.placeholder;
				input.disabled = oldInput.disabled;
				input.onkeyup = oldInput.onkeyup;
				input.onchange = oldInput.onchange;
				me._internal.AddDomElement(input);

				me.Height(-1);

				if (focused === true)
					input.focus();

				wasAutoChangedToMultiLineMode = false;

				me._internal.Data("multiline", "false");
				repaint();
			}
		}

		return (input.tagName === "TEXTAREA" && me.DesignMode() === false);
	}

	/// <function container="Fit.Controls.Input" name="Resizable" access="public" returns="Fit.Controls.InputResizing">
	/// 	<description>
	/// 		Get/set value indicating whether control is resizable on supported
	/// 		(modern) browsers. Making control resizable will disable Maximizable.
	/// 	</description>
	/// 	<param name="val" type="Fit.Controls.InputResizing" default="undefined">
	/// 		If defined, determines whether control resizes, and in what direction(s).
	/// 	</param>
	/// </function>
	this.Resizable = function(val)
	{
		Fit.Validation.ExpectStringValue(val, true);

		if (val === Fit.Controls.InputResizing.Enabled || val === Fit.Controls.InputResizing.Disabled || val === Fit.Controls.InputResizing.Horizontal || val === Fit.Controls.InputResizing.Vertical)
		{
			if (val !== resizable)
			{
				if (val !== Fit.Controls.InputResizing.Disabled) // Resizing enabled
				{
					if (me.Maximizable() === true)
					{
						me.Maximizable(false);
						//Fit.Browser.Log("Maximizable disabled as Resizable was enabled!");
					}

					if (me.MultiLine() === false && me.DesignMode() === false)
					{
						me.MultiLine(true);
						wasAutoChangedToMultiLineMode = true;
					}
				}
				else // Resizing disabled
				{
					// Reset custom width/height set by user

					var w = me.Width();
					me.Width(w.Value, w.Unit);

					var h = me.Height();
					me.Height(h.Value, h.Unit);
				}

				resizable = val;
				me._internal.Data("resizable", val.toLowerCase());

				if (val === Fit.Controls.InputResizing.Disabled)
				{
					me._internal.Data("resized", "false");

					input.style.width = "";
					input.style.height = "";
					input.style.margin = ""; // Chrome adds some odd margin when textarea is resized
				}

				revertToSingleLineIfNecessary();

				if (me.DesignMode() === true)
				{
					reloadEditor();
				}
			}
		}

		return resizable;
	}

	/// <function container="Fit.Controls.Input" name="Maximizable" access="public" returns="boolean">
	/// 	<description>
	/// 		Get/set value indicating whether control is maximizable.
	/// 		Making control maximizable will disable Resizable.
	/// 	</description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, True enables maximize button, False disables it </param>
	/// 	<param name="heightMax" type="number" default="undefined">
	/// 		If defined, this becomes the height of the input control when maximized.
	/// 		The value is considered the same unit set using Height(..) which defaults to px.
	/// 		If not set, the value assumes twice the height set using Height(..).
	/// 	</param>
	/// </function>
	this.Maximizable = function(val, heightMax)
	{
		Fit.Validation.ExpectBoolean(val, true);
		Fit.Validation.ExpectNumber(heightMax, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			if (val === true && cmdResize === null)
			{
				if (me.Resizable() !== Fit.Controls.InputResizing.Disabled)
				{
					me.Resizable(Fit.Controls.InputResizing.Disabled);
					//Fit.Browser.Log("Resizable disabled as Maximizable was enabled!");
				}

				if (me.MultiLine() === false && me.DesignMode() === false)
				{
					me.MultiLine(true);
					wasAutoChangedToMultiLineMode = true;
				}

				// Determine height to use when maximizing and minimizing

				var h = me.Height();

				minimizeHeight = h.Value;
				maximizeHeight = ((Fit.Validation.IsSet(heightMax) === true) ? heightMax : ((minimizeHeight !== -1) ? minimizeHeight * 2 : 300));
				minMaxUnit = h.Unit;
				maximizeHeightConfigured = heightMax || -1;

				// Create maximize/minimize button

				cmdResize = document.createElement("span");
				cmdResize.tabIndex = -1; // Allow button to temporarily gain focus so control does not fire OnBlur
				cmdResize.onclick = function()
				{
					me.Maximized(!me.Maximized());
					me.Focused(true);
				}
				Fit.Dom.AddClass(cmdResize, "fa");
				Fit.Dom.AddClass(cmdResize, "fa-chevron-down");
				me._internal.AddDomElement(cmdResize);

				// Update UI

				me._internal.Data("maximizable", "true");
				repaint();
			}
			else if (val === false && cmdResize !== null)
			{
				me._internal.RemoveDomElement(cmdResize);
				cmdResize = null;

				me.Height(minimizeHeight, minMaxUnit);
				minimizeHeight = -1;
				maximizeHeight = -1;
				minMaxUnit = null;

				me._internal.Data("maximizable", "false"); // Also set in MultiLine(..)

				revertToSingleLineIfNecessary();

				repaint();
			}
			else if (val === true && cmdResize !== null && Fit.Validation.IsSet(heightMax) === true)
			{
				// Already enabled - just update maximize height
				maximizeHeight = heightMax !== -1 ? heightMax : minimizeHeight * 2;
				maximizeHeightConfigured = heightMax;
			}
		}

		return (cmdResize !== null);
	}

	/// <function container="Fit.Controls.Input" name="Maximized" access="public" returns="boolean">
	/// 	<description> Get/set value indicating whether control is maximized </description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, True maximizes control, False minimizes it </param>
	/// </function>
	this.Maximized = function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		var autoGrowEnabled = me.Height().Value === -1 && me.DesignMode() === true;

		if (Fit.Validation.IsSet(val) === true && me.Maximizable() === true && autoGrowEnabled === false)
		{
			if (val === true && Fit.Dom.HasClass(cmdResize, "fa-chevron-up") === false)
			{
				me.Height(maximizeHeight, minMaxUnit, true);
				Fit.Dom.RemoveClass(cmdResize, "fa-chevron-down");
				Fit.Dom.AddClass(cmdResize, "fa-chevron-up");

				me._internal.Data("maximized", "true");
				repaint();
			}
			else if (val === false && Fit.Dom.HasClass(cmdResize, "fa-chevron-down") === false)
			{
				me.Height(minimizeHeight, minMaxUnit, true);
				Fit.Dom.RemoveClass(cmdResize, "fa-chevron-up");
				Fit.Dom.AddClass(cmdResize, "fa-chevron-down");

				me._internal.Data("maximized", "false"); // Also set in MultiLine(..)
				repaint();
			}
		}

		return (cmdResize !== null && Fit.Dom.HasClass(cmdResize, "fa-chevron-up") === true);
	}

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigPluginsImagesConfig">
	/// 	<description> Configuration for image plugins </description>
	/// 	<member name="Enabled" type="boolean"> Flag indicating whether to enable image plugins or not (defaults to False) </member>
	/// 	<member name="EmbedType" type="'base64' | 'blob'" default="undefined">
	/// 		How to store and embed images. Base64 (default) is persistent while blob is temporary
	/// 		and must be extracted from memory and uploaded/stored to be permanantly persisted.
	/// 		References to blobs can be parsed from the HTML value produced by the editor.
	/// 	</member>
	/// 	<member name="RevokeBlobUrlsOnDispose" type="'All' | 'UnreferencedOnly'" default="undefined">
	/// 		This option is in effect when EmbedType is blob.
	/// 		Dispose images from blob storage (revoke blob URLs) added though image plugins when control is disposed.
	/// 		If "UnreferencedOnly" is specified, the component using Fit.UI's input control will be responsible for
	/// 		disposing referenced blobs. Failing to do so may cause a memory leak. Defaults to All.
	/// 	</member>
	/// 	<member name="RevokeExternalBlobUrlsOnDispose" type="boolean" default="undefined">
	/// 		This option is in effect when EmbedType is blob.
	/// 		Dispose images from blob storage (revoke blob URLs) added through Value(..)
	/// 		function when control is disposed. Basically ownership of these blobs are handed
	/// 		over to the control for the duration of its life time.
	/// 		These images are furthermore subject to the rule set in RevokeBlobUrlsOnDispose.
	/// 		Defaults to False.
	/// 	</member>
	/// 	<member name="RevokeUnreferencedBlobUrlsOnValueSet" type="boolean" default="undefined">
	/// 		This option is in effect when EmbedType is blob.
	/// 		Dispose images from blob storage (revoke blob URLs) when value is changed with Value(..),
	/// 		but keep any images still referenced in new value. This is useful if an editor instance
	/// 		is being used to modify different HTML values over time.
	/// 	</member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigPluginsTablesConfig">
	/// 	<description> Configuration for table plugins </description>
	/// 	<member name="Enabled" type="boolean"> Flag indicating whether to enable table plugins or not (defaults to False) </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigPlugins">
	/// 	<description> Additional plugins enabled in DesignMode </description>
	/// 	<member name="Emojis" type="boolean" default="undefined"> Plugin(s) related to emoji support (defaults to False) </member>
	/// 	<member name="Images" type="Fit.Controls.InputTypeDefs.DesignModeConfigPluginsImagesConfig" default="undefined"> Plugin(s) related to support for images (not enabled by default) </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigToolbar">
	/// 	<description> Toolbar buttons enabled in DesignMode </description>
	/// 	<member name="Formatting" type="boolean" default="undefined"> Enable text formatting (bold, italic, underline) (defaults to True) </member>
	/// 	<member name="Justify" type="boolean" default="undefined"> Enable text alignment (defaults to True) </member>
	/// 	<member name="Lists" type="boolean" default="undefined"> Enable ordered and unordered lists with indentation (defaults to True) </member>
	/// 	<member name="Links" type="boolean" default="undefined"> Enable links (defaults to True) </member>
	/// 	<member name="Emojis" type="boolean" default="undefined"> Enable emoji button (defaults to False) </member>
	/// 	<member name="Images" type="boolean" default="undefined"> Enable image button (defaults to false) </member>
	/// 	<member name="Tables" type="boolean" default="undefined"> Enable table button (defaults to false) </member>
	/// 	<member name="Detach" type="boolean" default="undefined"> Enable detach button (defaults to false) </member>
	/// 	<member name="Position" type="'Top' | 'Bottom'" default="undefined"> Toolbar position (defaults to Top) </member>
	/// 	<member name="Sticky" type="boolean" default="undefined"> Make toolbar stick to edge of scroll container on supported browsers when scrolling (defaults to False) </member>
	/// 	<member name="HideWhenInactive" type="boolean" default="undefined"> Hide toolbar when control is inactive (defaults to False) </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigInfoPanel">
	/// 	<description> Information panel at the top or bottom of the editor, depending on the location of the toolbar </description>
	/// 	<member name="Text" type="string" default="undefined"> Text to display </member>
	/// 	<member name="Alignment" type="'Left' | 'Center' | 'Right'" default="undefined"> Text alignment - defaults to Center </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeTagsOnRequestEventHandlerArgs">
	/// 	<description> Request handler event arguments </description>
	/// 	<member name="Sender" type="Fit.Controls.Input"> Instance of control </member>
	/// 	<member name="Request" type="Fit.Http.JsonRequest | Fit.Http.JsonpRequest"> Instance of JsonRequest or JsonpRequest </member>
	/// 	<member name="Query" type="{ Marker: string, Query: string }"> Query information </member>
	/// </container>
	/// <function container="Fit.Controls.InputTypeDefs" name="DesignModeTagsOnRequest" returns="boolean | void">
	/// 	<description> Cancelable request event handler </description>
	/// 	<param name="sender" type="Fit.Controls.Input"> Instance of control </param>
	/// 	<param name="eventArgs" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnRequestEventHandlerArgs"> Event arguments </param>
	/// </function>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponseJsonTag">
	/// 	<description> JSON object representing tag </description>
	/// 	<member name="Value" type="string"> Unique value </member>
	/// 	<member name="Title" type="string"> Title </member>
	/// 	<member name="Icon" type="string" default="undefined"> Optional URL to icon/image </member>
	/// 	<member name="Url" type="string" default="undefined"> Optional URL to associate with tag </member>
	/// 	<member name="Data" type="string" default="undefined"> Optional data to associate with tag </member>
	/// 	<member name="Context" type="string" default="undefined"> Optional context information to associate with tag </member>
	/// </container>
	/// <container name="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponseEventHandlerArgs">
	/// 	<description> Response handler event arguments </description>
	/// 	<member name="Sender" type="Fit.Controls.Input"> Instance of control </member>
	/// 	<member name="Request" type="Fit.Http.JsonRequest | Fit.Http.JsonpRequest"> Instance of JsonRequest or JsonpRequest </member>
	/// 	<member name="Query" type="{ Marker: string, Query: string }"> Query information </member>
	/// 	<member name="Tags" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponseJsonTag[]"> Tags received from WebService </member>
	/// </container>
	/// <function container="Fit.Controls.InputTypeDefs" name="DesignModeTagsOnResponse">
	/// 	<description> Response event handler </description>
	/// 	<param name="sender" type="Fit.Controls.Input"> Instance of control </param>
	/// 	<param name="eventArgs" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponseEventHandlerArgs"> Event arguments </param>
	/// </function>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeTagsTagCreatorReturnType">
	/// 	<description> JSON object representing tag to be inserted into editor </description>
	/// 	<member name="Title" type="string"> Tag title </member>
	/// 	<member name="Value" type="string"> Tag value (ID) </member>
	/// 	<member name="Type" type="string"> Tag type (marker) </member>
	/// 	<member name="Url" type="string" default="undefined"> Optional tag URL </member>
	/// 	<member name="Data" type="string" default="undefined"> Optional tag data </member>
	/// 	<member name="Context" type="string" default="undefined"> Optional tag context </member>
	/// </container>
	/// <container name="Fit.Controls.InputTypeDefs.DesignModeTagsTagCreatorCallbackArgs">
	/// 	<description> TagCreator event arguments </description>
	/// 	<member name="Sender" type="Fit.Controls.Input"> Instance of control </member>
	/// 	<member name="QueryMarker" type="string"> Query marker </member>
	/// 	<member name="Tag" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponseJsonTag"> Tag received from WebService </member>
	/// </container>
	/// <function container="Fit.Controls.InputTypeDefs" name="DesignModeTagsTagCreator" returns="Fit.Controls.InputTypeDefs.DesignModeTagsTagCreatorReturnType | null | void">
	/// 	<description>
	/// 		Function producing JSON object representing tag to be inserted into editor.
	/// 		Returning nothing or Null results in default tag being inserted into editor.
	/// 	</description>
	/// 	<param name="sender" type="Fit.Controls.Input"> Instance of control </param>
	/// 	<param name="eventArgs" type="Fit.Controls.InputTypeDefs.DesignModeTagsTagCreatorCallbackArgs"> Event arguments </param>
	/// </function>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfigTags">
	/// 	<description> Configuration for tags in DesignMode </description>
	/// 	<member name="Triggers" type="{ Marker: string, MinimumCharacters?: integer, DebounceQuery?: integer, Pattern?: RegExp }[]">
	/// 		Markers triggering tags request and context menu.
	/// 		Notice that Pattern, if specified, must include the marker for match to occur,
	/// 		as well as specifying the minimum amount of characters - e.g. /^@[a-z]{3,}$/
	/// 	</member>
	/// 	<member name="QueryUrl" type="string">
	/// 		URL to request data from. Endpoint receives the following payload:
	/// 		{ Marker: "@", Query: "search" }
	///
	/// 		Data is expected to be returned in the following format:
	/// 		[
	/// 		    { Value: "t-1", Title: "Tag 1", Icon: "images/img1.jpeg", Url: "show/1", Data: "..." },
	/// 		    { Value: "t-2", Title: "Tag 2", Icon: "images/img2.jpeg", Url: "show/2", Data: "..." }, ...
	/// 		]
	///
	/// 		The Value and Title properties are required. The Icon property is optional and must specify the path to an image.
	/// 		The Url property is optional and must specify a path to a related page/resource.
	/// 		The Data property is optional and allows for additional data to be associated with the tag.
	/// 		To hold multiple values, consider using a base64 encoded JSON object:
	/// 		btoa(JSON.stringify({ creationDate: new Date(), active: true }))
	///
	/// 		The data eventuelly results in a tag being added to the editor with the following format:
	/// 		<a data-tag-type="@" data-tag-id="unique id 1" data-tag-data="..." data-tag-context="..." href="show/1">Tag name 1</a>
	/// 		The data-tag-data and data-tag-context attributes are only declared if the corresponding Data and Context properties are defined in data.
	/// 	</member>
	/// 	<member name="JsonpCallback" type="string" default="undefined"> Name of URL parameter receiving name of JSONP callback function (only for JSONP services) </member>
	/// 	<member name="JsonpTimeout" type="integer" default="undefined"> Number of milliseconds to allow JSONP request to wait for a response before aborting (only for JSONP services) </member>
	/// 	<member name="OnRequest" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnRequest" default="undefined">
	/// 		Event handler invoked when tags are requested. Request may be canceled by returning False.
	/// 		Function receives two arguments:
	/// 		Sender (Fit.Controls.Input) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.Input instance
	/// 		 - Request: Fit.Http.JsonpRequest or Fit.Http.JsonRequest instance
	/// 		 - Query: Contains query information in its Marker and Query property
	/// 	</member>
	/// 	<member name="OnResponse" type="Fit.Controls.InputTypeDefs.DesignModeTagsOnResponse" default="undefined">
	/// 		Event handler invoked when tags data is received, allowing for data transformation.
	/// 		Function receives two arguments:
	/// 		Sender (Fit.Controls.Input) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.Input instance
	/// 		 - Request: Fit.Http.JsonpRequest or Fit.Http.JsonRequest instance
	/// 		 - Query: Contains query information in its Marker and Query property
	/// 		 - Tags: JSON tags array received from WebService
	/// 	</member>
	/// 	<member name="TagCreator" type="Fit.Controls.InputTypeDefs.DesignModeTagsTagCreator" default="undefined">
	/// 		Callback invoked when a tag is being inserted into editor, allowing
	/// 		for customization to the title and attributes associated with the tag.
	/// 		Function receives two arguments:
	/// 		Sender (Fit.Controls.Input) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.Input instance
	/// 		 - QueryMarker: String containing query marker
	/// 		 - Tag: JSON tag received from WebService
	/// 	</member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeAutoGrow">
	/// 	<description> Auto grow configuration </description>
	/// 	<member name="Enabled" type="boolean"> Flag indicating whether auto grow feature is enabled or not - on by default if no height is set, or if Height(-1) is set </member>
	/// 	<member name="MinimumHeight" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Minimum height of editable area </member>
	/// 	<member name="MaximumHeight" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Maximum height of editable area </member>
	/// 	<member name="PreventResizeBeyondMaximumHeight" type="boolean" default="undefined"> Prevent user from resizing editor beyond maximum height (see MaximumHeight property - defaults to False) </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeDetachable">
	/// 	<description> Detachable configuration </description>
	/// 	<member name="Title" type="string" default="undefined"> Dialog title </member>
	/// 	<member name="Maximizable" type="boolean" default="undefined"> Flag indicating whether dialog is maximizable </member>
	/// 	<member name="Maximized" type="boolean" default="undefined"> Flag indicating whether dialog is initially maximized </member>
	/// 	<member name="Draggable" type="boolean" default="undefined"> Flag indicating whether dialog is draggable </member>
	/// 	<member name="Resizable" type="boolean" default="undefined"> Flag indicating whether dialog is resizable </member>
	/// 	<member name="Width" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Dialog width </member>
	/// 	<member name="MinimumWidth" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Minimum width of dialog </member>
	/// 	<member name="MaximumWidth" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Maximum Width of dialog </member>
	/// 	<member name="Height" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Dialog height </member>
	/// 	<member name="MinimumHeight" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Minimum height of dialog </member>
	/// 	<member name="MaximumHeight" type="{ Value: number, Unit?: Fit.TypeDefs.CssUnit }" default="undefined"> Maximum height of dialog </member>
	/// </container>

	/// <container name="Fit.Controls.InputTypeDefs.DesignModeConfig">
	/// 	<description> Configuration for DesignMode </description>
	/// 	<member name="Plugins" type="Fit.Controls.InputTypeDefs.DesignModeConfigPlugins" default="undefined"> Plugins configuration </member>
	/// 	<member name="Toolbar" type="Fit.Controls.InputTypeDefs.DesignModeConfigToolbar" default="undefined"> Toolbar configuration </member>
	/// 	<member name="InfoPanel" type="Fit.Controls.InputTypeDefs.DesignModeConfigInfoPanel" default="undefined"> Information panel configuration </member>
	/// 	<member name="Tags" type="Fit.Controls.InputTypeDefs.DesignModeConfigTags" default="undefined"> Tags configuration </member>
	/// 	<member name="AutoGrow" type="Fit.Controls.InputTypeDefs.DesignModeAutoGrow" default="undefined"> Auto grow configuration </member>
	/// 	<member name="Detachable" type="Fit.Controls.InputTypeDefs.DesignModeDetachable" default="undefined"> Detachable configuration </member>
	/// </container>

	/// <function container="Fit.Controls.Input" name="DesignMode" access="public" returns="boolean">
	/// 	<description>
	/// 		Get/set value indicating whether control is in Design Mode allowing for rich HTML content.
	/// 		Notice that this control type requires dimensions (Width/Height) to be specified in pixels.
	/// 	</description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, True enables Design Mode, False disables it </param>
	/// 	<param name="editorConfig" type="Fit.Controls.InputTypeDefs.DesignModeConfig" default="undefined">
	/// 		If provided and DesignMode is enabled, configuration is applied when editor is created.
	/// 	</param>
	/// </function>
	this.DesignMode = function(val, editorConfig)
	{
		Fit.Validation.ExpectBoolean(val, true);
		Fit.Validation.ExpectObject(editorConfig, true);
		Fit.Validation.ExpectObject((editorConfig || {}).Plugins, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Plugins || {}).Emojis, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Plugins || {}).Images, true);
		Fit.Validation.ExpectBoolean((((editorConfig || {}).Plugins || {}).Images || {}).Enabled, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Plugins || {}).Images || {}).EmbedType, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Plugins || {}).Images || {}).RevokeBlobUrlsOnDispose, true);
		Fit.Validation.ExpectBoolean((((editorConfig || {}).Plugins || {}).Images || {}).RevokeExternalBlobUrlsOnDispose, true);
		Fit.Validation.ExpectObject((editorConfig || {}).Toolbar, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Formatting, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Justify, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Lists, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Links, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Emojis, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Images, true);
		Fit.Validation.ExpectStringValue(((editorConfig || {}).Toolbar || {}).Position, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Sticky, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).HideWhenInactive, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Toolbar || {}).Detach, true);
		Fit.Validation.ExpectObject((editorConfig || {}).InfoPanel, true);
		Fit.Validation.ExpectString(((editorConfig || {}).InfoPanel || {}).Text, true);
		Fit.Validation.ExpectString(((editorConfig || {}).InfoPanel || {}).Alignment, true);
		Fit.Validation.ExpectObject((editorConfig || {}).Tags, true);
		Fit.Validation.ExpectObject((editorConfig || {}).AutoGrow, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).AutoGrow || {}).Enabled, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).AutoGrow || {}).MinimumHeight, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).AutoGrow || {}).MinimumHeight || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).AutoGrow || {}).MinimumHeight || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).AutoGrow || {}).MaximumHeight, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).AutoGrow || {}).MaximumHeight || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).AutoGrow || {}).MaximumHeight || {}).Unit, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).AutoGrow || {}).PreventResizeBeyondMaximumHeight, true);
		Fit.Validation.ExpectObject((editorConfig || {}).Detachable, true);
		Fit.Validation.ExpectString(((editorConfig || {}).Detachable || {}).Title, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Detachable || {}).Maximizable, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Detachable || {}).Maximized, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Detachable || {}).Draggable, true);
		Fit.Validation.ExpectBoolean(((editorConfig || {}).Detachable || {}).Resizable, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).Width, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).Width || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).Width || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).MinimumWidth, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).MinimumWidth || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).MinimumWidth || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).MaximumWidth, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).MaximumWidth || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).MaximumWidth || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).Height, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).Height || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).Height || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).MinimumHeight, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).MinimumHeight || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).MinimumHeight || {}).Unit, true);
		Fit.Validation.ExpectObject(((editorConfig || {}).Detachable || {}).MaximumHeight, true);
		Fit.Validation.ExpectNumber((((editorConfig || {}).Detachable || {}).MaximumHeight || {}).Value, true);
		Fit.Validation.ExpectStringValue((((editorConfig || {}).Detachable || {}).MaximumHeight || {}).Unit, true);

		if (editorConfig && editorConfig.Tags)
		{
			Fit.Validation.ExpectTypeArray(editorConfig.Tags.Triggers, function(trigger)
			{
				Fit.Validation.ExpectStringValue(trigger.Marker);
				Fit.Validation.ExpectInteger(trigger.MinimumCharacters, true);
				Fit.Validation.ExpectInteger(trigger.DebounceQuery, true);
				Fit.Validation.ExpectInstance(trigger.Pattern, RegExp, true);
			});
			Fit.Validation.ExpectStringValue(editorConfig.Tags.QueryUrl);
			Fit.Validation.ExpectStringValue(editorConfig.Tags.JsonpCallback, true);
			Fit.Validation.ExpectInteger(editorConfig.Tags.JsonpTimeout, true);
			Fit.Validation.ExpectFunction(editorConfig.Tags.OnRequest, true);
			Fit.Validation.ExpectFunction(editorConfig.Tags.OnResponse, true);
			Fit.Validation.ExpectFunction(editorConfig.Tags.TagCreator, true);
		}

		if (Fit.Validation.IsSet(val) === true)
		{
			var designMode = (me._internal.Data("designmode") === "true");

			if (Fit._internal.Controls.Input.ActiveEditorForDialog === me && Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed === true)
				designMode = false; // Not considered in Design Mode if scheduled to be disabled (postponed because a dialog is currently loading)

			if ((val === true && designMode === false) || (val === true && Fit.Validation.IsSet(editorConfig) === true && Fit.Core.IsEqual(editorConfig, designEditorConfig) === false))
			{
				var configUpdated = designMode === true; // Already in DesignMode which means editorConfig was changed

				if (Fit._internal.Controls.Input.ActiveEditorForDialog === me)
				{
					// Control is actually already in Design Mode, but waiting
					// for dialog to finish loading, so DesignMode can be disabled (scheduled).
					// Remove flag responsible for disabling DesignMode so it remains an editor.
					delete Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed;

					if (configUpdated === false)
					{
						return true;
					}
				}

				if (configUpdated === true)
				{
					reloadEditor(false, Fit.Core.Clone(editorConfig)); // Clone to prevent external code from making changes later
					return true;
				}

				if (Fit.Validation.IsSet(editorConfig) === true)
				{
					designEditorConfig = Fit.Core.Clone(editorConfig); // Clone to prevent external code from making changes later
				}

				// Notice: Identical logic found in Value(..)!
				if (designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.RevokeExternalBlobUrlsOnDispose === true)
				{
					// Keep track of image blobs added via Value(..) so we can dispose of them automatically.
					// When RevokeExternalBlobUrlsOnDispose is True it basically means that the Input control
					// is allowed (and expected) to take control over memory management for these blobs
					// based on the rule set in RevokeBlobUrlsOnDispose.
					// This code is also found in Value(..) since images might be added after editor has been created.

					var blobUrls = Fit.String.ParseImageBlobUrls(me.Value());

					Fit.Array.ForEach(blobUrls, function(blobUrl)
					{
						if (Fit.Array.Contains(imageBlobUrls, blobUrl) === false)
						{
							Fit.Array.Add(imageBlobUrls, blobUrl);
						}
					});
				}

				if (me.MultiLine() === false)
				{
					me.MultiLine(true);
					wasAutoChangedToMultiLineMode = true;
				}

				me._internal.Data("designmode", "true");
				me._internal.Data("toolbar", designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.HideWhenInactive === true ? "false" : "true");
				me._internal.Data("toolbar-position", designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.Position === "Bottom" ? "bottom" : "top");
				me._internal.Data("toolbar-sticky", designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.Sticky === true ? "true" : "false");

				// Prevent control from losing focus when HTML editor is initialized,
				// e.g. if Design Mode is enabled when ordinary input control gains focus.
				// This also prevents control from losing focus if toolbar is clicked without
				// hitting a button. A value of -1 makes it focusable, but keeps it out of
				// tab flow (keyboard navigation). Also set when Enabled(true) is called.
				me.GetDomElement().tabIndex = -1; // TabIndex is removed if DesignMode is disabled (DesignMode(false)) or if control is disabled (Enabled(false))

				if (me.Focused() === true)
				{
					// Move focus from input to control's outer container (tabindex
					// set above) to keep focus while editor is loading/initializing.
					// Focus is moved to editor once initialization is complete - see
					// instanceReady handler.
					me.GetDomElement().focus();
				}

				input.id = me.GetId() + "_DesignMode";

				if (window.CKEDITOR === undefined)
				{
					window.CKEDITOR = null;

					Fit.Loader.LoadScript(Fit.GetUrl() + "/Resources/CKEditor/ckeditor.js?cacheKey=" + Fit.GetVersion().Version, function(src) // Using Fit.GetUrl() rather than Fit.GetPath() to allow editor to be used on e.g. JSFiddle (Cross-Origin Resource Sharing policy)
					{
						// WARNING: Control could potentially have been disposed at this point, but
						// we still need to finalize the configuration of CKEditor which is global.

						// Prevent CKEditor from automatically converting editable elements to inline editors.
						// https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR.html#cfg-disableAutoInline
						CKEDITOR.disableAutoInline = true;

						if (Fit.Validation.IsSet(Fit._internal.Controls.Input.Editor.Skin) === true)
						{
							CKEDITOR.config.skin = Fit._internal.Controls.Input.Editor.Skin;
						}

						CKEDITOR.on("instanceReady", function(ev)
						{
							// Do not produce XHTML self-closing tags such as <br /> and <img src="img.jpg" />
							// https://ckeditor.com/docs/ckeditor4/latest/features/output_format.html
							// NOTICE: The htmlwriter plugin is required for this to work!
							// Output produced is now both HTML4 and HTML5 compatible, but is not valid
							// XHTML anymore! Self-closing tags are allowed in HTML5 but not valid in HTML4.
							ev.editor.dataProcessor.writer.selfClosingEnd = ">"; // Defaults to ' />'
						});

						// Register OnShow and OnHide event handlers when a dialog is opened for the first time.
						// IMPORTANT: These event handlers are shared by all input control instances in Design Mode,
						// so we cannot use 'me' to access the current control for which a dialog is opened.
						// Naturally 'me' will always be a reference to the first control that opened a given dialog.
						CKEDITOR.on("dialogDefinition", function(e) // OnDialogDefinition fires only once
						{
							var dialogName = e.data.name;
							var dialogDef = e.data.definition;

							if (dialogName === "table")
							{
								// Remove default table width (500px).
								// Allow table width to adjust to content.
								dialogDef.getContents("info").get("txtWidth").default = "";
							}

							var dialog = dialogDef.dialog;

							dialog.on("show", function(ev)
							{
								if (Fit._internal.Controls.Input.ActiveDialogForEditorCanceled)
								{
									// Focused(false) was called on control while dialog was loading - close dialog

									if (Fit.Browser.GetBrowser() === "MSIE" && Fit.Browser.GetVersion() < 9)
									{
										// CKEditor uses setTimeout(..) to focus an input field in the dialog, but if the dialog is
										// closed immediately, that input field will be removed from DOM along with the dialog of course,
										// which in IE8 results in an error:
										// "Can't move focus to the control because it is invisible, not enabled, or of a type that does not accept the focus."
										// Other browsers simply ignore the request to focus a control that is no longer found in DOM.
										setTimeout(function()
										{
											ev.sender.hide(); // Fires OnHide
										}, 100);
									}
									else
									{
										ev.sender.hide(); // Fires OnHide
									}

									return;
								}

								if (Fit._internal.Controls.Input.ActiveEditorForDialog === undefined)
									return; // Control was disposed while waiting for dialog to load and open

								Fit.Dom.Data(ev.sender.getElement().$, "skin", CKEDITOR.config.skin); // Add e.g. data-skin="bootstrapck" to dialog - used in Input.css

								// Keep instance to dialog so we can close it if e.g. Focused(false) is invoked
								Fit._internal.Controls.Input.ActiveDialogForEditor = ev.sender;

								if (Fit._internal.Controls.Input.ActiveEditorForDialogDestroyed)
								{
									// Dispose() was called on control while dialog was loading.
									// Since destroying editor while a dialog is loading would cause
									// an error in CKEditor, the operation has been postponed til dialog's
									// OnShow event fires, and the dialog is ready.
									setTimeout(function()
									{
										// Dispose() calls destroy() on editor which closes dialog and causes the dialog's OnHide event to fire.
										// Dispose() uses Fit._internal.Controls.Input.ActiveDialogForEditor, which is why it is set above, before
										// checking whether control has been destroyed (scheduled for destruction).
										Fit._internal.Controls.Input.ActiveEditorForDialog.Dispose();
									}, 0); // Postponed - CKEditor throws an error if destroyed from OnShow event handler

									return;
								}

								if (Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed)
								{
									setTimeout(function()
									{
										delete Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed;

										// DesignMode(false) calls destroy() on editor which closes dialog and causes the dialog's OnHide event to fire.
										Fit._internal.Controls.Input.ActiveEditorForDialog.DesignMode(false);
									}, 0); // Postponed - CKEditor throws an error if destroyed from OnShow event handler

									return;
								}

								// Allow light dismissable panels/callouts to prevent close/dismiss
								// when interacting with editor dialogs hosted outside of these panels/callouts,
								// by detecting the presence of the data-disable-light-dismiss="true" attribute.

								var ckeDialogElement = this.getElement().$;
								Fit.Dom.Data(ckeDialogElement, "disable-light-dismiss", "true");

								var bgModalLayer = document.querySelector("div.cke_dialog_background_cover"); // Shared among instances
								if (bgModalLayer !== null) // Better safe than sorry
								{
									Fit.Dom.Data(bgModalLayer, "disable-light-dismiss", "true");
								}

								// Reduce pollution of document root

								if (Fit._internal.ControlBase.ReduceDocumentRootPollution === true)
								{
									// Move dialog to control - otherwise placed in the root of the document where it pollutes,
									// and makes it impossible to interact with the dialog in light dismissable panels and callouts.
									// Dialog is placed alongside control and not within the control's container, to prevent Fit.UI
									// styling from affecting the dialog.
									// DISABLED: It breaks file picker controls in dialogs which are hosted in iframes.
									// When an iframe is re-rooted in DOM it reloads, and any dynamically created content is lost.
									// We will have to increase the z-index to make sure dialogs open on top of modal layers.
									// EDIT 2021-08-20: Enabled again. The base64image plugin has now been altered so it no longer
									// uses CKEditor's built-in file picker which is wrapped in an iFrame. Therefore the dialog can
									// once again be mounted next to the Input control.

									var ckeDialogElement = this.getElement().$;
									Fit.Dom.InsertAfter(Fit._internal.Controls.Input.ActiveEditorForDialog.GetDomElement(), ckeDialogElement);

									// 2nd+ time dialog is opened it remains invisible - make it appear and position it
									ckeDialogElement.style.display = !CKEDITOR.env.ie || CKEDITOR.env.edge ? "flex" : ""; // https://github.com/ckeditor/ckeditor4/blob/8b208d05d1338d046cdc8f971c9faf21604dd75d/plugins/dialog/plugin.js#L152
									this.layout(); // 'this' is the dialog instance - layout() positions dialog

									// Temporarily move modal background layer next to control to ensure it is part of same
									// stacking context as control and dialog. Otherwise it might stay on top of a panel containing
									// the editor, if that panel has position:fixed (which creates a separate stacking context)
									// and a lower z-index than the background layer.
									// Be aware that the background layer also has position:fixed so it will "escape" a parent
									// container that also has position:fixed, still making it stretch from the upper left corner
									// of the screen to the lower right corner of the screen. However, if a parent is using
									// CSS transform, it will prevent the background layer from escaping, instead positioning it
									// and making it stretch from the upper left corner of the container using transform, to the
									// lower right corner of that container.
									// Also be aware that the use of transform will cause minor problems when moving/dragging dialog,
									// although that is not related to remounting of the background layer.
									var bgModalLayer = document.querySelector("div.cke_dialog_background_cover");
									if (bgModalLayer !== null) // Better safe than sorry
									{
										Fit.Dom.InsertAfter(Fit._internal.Controls.Input.ActiveEditorForDialog.GetDomElement(), bgModalLayer);
									}

									if (ev.sender.definition.title === "Image")
									{
										// Hide image resize handles placed in the root of the document.
										// When the modal background layer above is rooted next to the control,
										// it becomes impossible to ensure the resize handles remains hidden behind
										// the background layer, since the control may be part of a stacking context
										// different from the one containing the image resize handles (document root).
										// It would require dynamic z-index values to achieve this. Therefore the
										// resize handles are temporarily hidden instead.

										var imageResizeHandlersContainer = document.querySelector("#ckimgrsz");
										if (imageResizeHandlersContainer !== null) // Better safe than sorry
										{
											imageResizeHandlersContainer.style.display = "none";
										}
									}
								}
							});

							dialog.on("hide", function(ev) // Fires when user closes dialog, or when hide() is called on dialog, or if destroy() is called on editor instance from Dispose() or DesignMode(false)
							{
								var inputControl = Fit._internal.Controls.Input.ActiveEditorForDialog;
								var showCanceledDueToBlur = Fit._internal.Controls.Input.ActiveDialogForEditorCanceled === true;

								// Clean up global references accessible while dialog is open
								delete Fit._internal.Controls.Input.ActiveEditorForDialog;
								delete Fit._internal.Controls.Input.ActiveEditorForDialogDestroyed;
								delete Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed;
								delete Fit._internal.Controls.Input.ActiveDialogForEditor;
								delete Fit._internal.Controls.Input.ActiveDialogForEditorCanceled;

								if (Fit._internal.ControlBase.ReduceDocumentRootPollution === true)
								{
									// Return modal background layer to document root - it was temporarily moved
									// next to control to ensure it works properly with current stacking context.
									// See comments regarding this in dialog "show" handler registered above.
									// The background layer will not work for other editor instances if not moved back.
									var bgModalLayer = document.querySelector("div.cke_dialog_background_cover");
									if (bgModalLayer !== null) // Better safe than sorry
									{
										Fit.Dom.Add(document.body, bgModalLayer);
									}

									// Allow image resize handlers to show up again (hidden in "show" handler registered above)
									if (ev.sender.definition.title === "Image")
									{
										var imageResizeHandlersContainer = document.querySelector("#ckimgrsz");
										if (imageResizeHandlersContainer !== null) // Better safe than sorry
										{
											imageResizeHandlersContainer.style.display = "";
										}
									}
								}

								// Disable focus lock - let ControlBase handle OnFocus and OnBlur automatically again.
								// This is done postponed since unlocking it immediately will cause OnFocus to fire when
								// dialog returns focus to the editor.
								setTimeout(function()
								{
									if (inputControl.GetDomElement() === null)
										return; // Control was disposed - OnHide was fired because destroy() was called on editor instance from Dispose()

									inputControl._internal.FocusStateLocked(false);

									if (showCanceledDueToBlur === true)
									{
										// Undo focus which dialog returned to editor.
										// ControlBase fires OnBlur because focus state was unlocked above.
										Fit.Dom.GetFocused().blur();
									}
								}, 0);
							});
						});

						if (me === null)
							return; // Control was disposed while waiting for jQuery UI to load

						if (me.DesignMode() === false)
							return; // DesignMode was disabled while waiting for resources to load

						createEditor();
					});
				}
				else if (window.CKEDITOR === null)
				{
					if (createWhenReadyIntervalId === -1) // Make sure DesignMode has not been enabled multiple times - e.g. DesignMode(true); DesignMode(false); DesignMode(true); - in which case an interval timer may already be "waiting" for CKEditor resources to finish loading
					{
						createWhenReadyIntervalId = setInterval(function()
						{
							/*if (me === null)
							{
								// Control was disposed while waiting for CKEditor to finish loading
								clearInterval(iId);
								return;
							}*/

							if (window.CKEDITOR !== null)
							{
								clearInterval(createWhenReadyIntervalId);
								createWhenReadyIntervalId = -1;

								// Create editor if still in DesignMode (might have been disabled while waiting for
								// CKEditor resources to finish loading), and if editor has not already been created.
								// Editor may already exist if control had DesignMode enabled, then disabled, and then
								// enabled once again.
								// If the control is the first one to enabled DesignMode, it will start loading CKEditor
								// resources and postpone editor creation until resources have finished loading.
								// When disabled and re-enabled, the control will realize that resources are being loaded,
								// and postpone editor creation once again, this time using the interval timer here.
								// When resources are loaded, it will create the editor instances, and when the interval
								// timer here executes, it will also create the editor instance, unless we prevent it by
								// making sure only to do it if designEditor is null. Without this check we might experience
								// the following warning in the browser console, when editor is being created on the same
								// textarea control multiple times:
								// [CKEDITOR] Error code: editor-element-conflict. {editorName: "64992ea4-bd01-4081-b606-aa9ff23f417b_DesignMode"}
								// [CKEDITOR] For more information about this error go to https://ckeditor.com/docs/ckeditor4/latest/guide/dev_errors.html#editor-element-conflict
								if (me.DesignMode() === true && designEditor === null)
								{
									createEditor();
								}
							}
						}, 500);
					}
				}
				else
				{
					createEditor();
				}

				if (me.Resizable() !== Fit.Controls.InputResizing.Disabled) // Undo any resizing done in ordinary MultiLine mode
				{
					Fit.Dom.Data(me.GetDomElement(), "resized", "false");

					input.style.width = "";
					input.style.height = "";
					input.style.margin = ""; // Chrome adds some odd margin when textarea is resized
				}

				var enableAutoGrow = me.Height().Value === -1 || (designEditorConfig !== null && designEditorConfig.AutoGrow && designEditorConfig.AutoGrow.Enabled === true);

				if (enableAutoGrow === true && me.Maximizable() === true)
				{
					// Maximize button is disabled when auto grow is enabled, but we make sure to "minimize" control
					// so maximize button returns to its initial state, in case control was maximized prior to enabling
					// DesignMode with auto grow. Otherwise the button indicates that the control is maximized, and so
					// does calls to Maximized() which will incorrectly return True.
					me.Maximized(false);
				}

				repaint();
			}
			else if (val === false && designMode === true)
			{
				if (designModeEnabledAndReady() === false)
				{
					console.error("DesignMode(false) is not allowed for Input control '" + me.GetId() + "' while DesignMode editor is initializing!");
					return true; // Return current un-modified state - DesignMode remains enabled
				}

				var focused = me.Focused();

				if (focused === true) // Make sure focus is preserved when editor is destroyed
				{
					me.GetDomElement().focus();
				}

				if (Fit._internal.Controls.Input.ActiveEditorForDialog === me)
				{
					if (Fit._internal.Controls.Input.ActiveDialogForEditor !== null)
					{
						Fit._internal.Controls.Input.ActiveDialogForEditor.hide(); // Fires dialog's OnHide event
					}
					else
					{
						// Dialog is still loading - calling designEditor.destroy() below will cause an error,
						// leaving a modal layer on the page behind, making it unusable. This may happen if Design Mode is disabled
						// from e.g. a DOM event handler, a mutation observer, a timer, or an AJAX request. The input control
						// itself does not fire any events while the dialog is loading which could trigger this situation, so
						// this can only happen from "external code".

						// WARNING: This has the potential to leak memory if dialog never loads and resumes task of destroying control!
						Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed = true;

						// Detect memory leak
						/* setTimeout(function()
						{
							if (me !== null && me.DesignMode() === false && Fit._internal.Controls.Input.ActiveEditorForDialog === me)
							{
								Fit.Browser.Log("WARNING: Input in DesignMode was not properly disposed in time - potential memory leak detected");
							}
						}, 5000); // Usually the load time for a dialog is barely measurable, so 5 seconds seems sufficient */

						return true; // Return current un-modified state - DesignMode remains enabled until dialog is done loading
					}
				}

				if (designEditorActiveToolbarPanel !== null)
				{
					designEditorActiveToolbarPanel.CloseEmojiPanel();
				}

				// Destroy editor - content is automatically synchronized to input control.
				// Calling destroy() fires OnHide for any dialog currently open, which in turn
				// disables locked focus state and returns focus to the control.
				destroyDesignEditorInstance();

				me._internal.Data("designmode", "false");
				Fit.Dom.Data(me.GetDomElement(), "resized", "false");

				// Remove DesignMode specific data attributes
				me._internal.Data("autogrow", null);
				me._internal.Data("toolbar", null);
				me._internal.Data("toolbar-position", null);
				me._internal.Data("toolbar-sticky", null);

				revertToSingleLineIfNecessary();
				if (focused === true)
				{
					// On IE8 input.focus() does not work if input field is switched to a traditional input field,
					// or if input field is hidden/invisible. It's just not reliable and not worth it. Remove focus
					// from the control in IE8 when DesignMode is disabled and preserve focus in every other browser.

					if (isIe8 === false)
					{
						input.focus();
					}
					else
					{
						me.GetDomElement().blur(); // Control container was given focus further up - this will fire OnBlur as expected
					}
				}

				// Remove tabindex used to prevent control from losing focus when clicking toolbar buttons
				Fit.Dom.Attribute(me.GetDomElement(), "tabindex", null);

				repaint();
			}
		}

		return (me._internal.Data("designmode") === "true");
	}

	/// <function container="Fit.Controls.Input" name="DebounceOnChange" access="public" returns="integer">
	/// 	<description>
	/// 		Get/set number of milliseconds used to postpone onchange event.
	/// 		Every new keystroke/change resets the timer. Debouncing can
	/// 		improve performance when working with large amounts of data.
	/// 	</description>
	/// 	<param name="timeout" type="integer" default="undefined"> If defined, timeout value (milliseconds) is updated - a value of -1 disables debouncing </param>
	/// </function>
	this.DebounceOnChange = function(timeout)
	{
		Fit.Validation.ExpectInteger(timeout, true);

		if (Fit.Validation.IsSet(timeout) === true && timeout !== debounceOnChangeTimeout)
		{
			debounceOnChangeTimeout = timeout;

			if (debouncedOnChange !== null)
			{
				debouncedOnChange.Flush();
				debouncedOnChange = null; // Re-created when needed with new timeout value
			}
		}

		return debounceOnChangeTimeout;
	}

	// ============================================
	// Protected
	// ============================================

	this._internal = (this._internal ? this._internal : {});

	this._internal.DesignModeEnabledAndReady = function()
	{
		return designModeEnabledAndReady();
	}

	// ============================================
	// Private
	// ============================================

	function createEditor()
	{
		// NOTICE: CKEDITOR requires input control to be rooted in DOM.
		// Creating the editor when Render(..) is called is not the solution, since the programmer
		// may call GetDomElement() instead and root the element at any given time which is out of our control.
		// It may be possible to temporarily root the control and make it invisible while the control
		// is being created, and remove it from the DOM when instanceReady is fired. However, since creating
		// the editor is an asynchronous operation, we need to detect whether the element has been rooted
		// elsewhere when instanceCreated is fired, and only remove it from the DOM if this is not the case.
		// This problem needs to be solved some other time as it may spawn other problems, such as determining
		// the size of objects while being invisible. The CKEditor team may also solve the bug in an update.
		if (Fit.Dom.IsRooted(me.GetDomElement()) === false)
		{
			//Fit.Validation.ThrowError("Control must be appended/rendered to DOM before DesignMode can be initialized");

			var retry = function()
			{
				if (Fit.Dom.IsRooted(me.GetDomElement()) === true)
				{
					if (me.DesignMode() === true)
					{
						createEditor();
					}

					return true;
				}

				// Return False to indicate that we still need to keep retrying (still in DesignMode).
				// Otherwie return True to indicate success - retrying is no longer relevant.
				return (me.DesignMode() === true ? false : true);
			};

			setTimeout(function() // Queue to allow control to be rooted
			{
				if (me === null)
				{
					return; // Control was disposed
				}

				if (retry() === false)
				{
					// Still not rooted - add observer to create editor instance once control is rooted

					rootedEventId = Fit.Events.AddHandler(me.GetDomElement(), "#rooted", function(e)
					{
						if (retry() === true || me.DesignMode() === false)
						{
							Fit.Events.RemoveHandler(me.GetDomElement(), rootedEventId);
							rootedEventId = -1;
						}
					});
				}
			}, 0);

			return;
		}

		var langSupport = ["da", "de", "en", "no"];
		var localeCode = Fit.Internationalization.Locale().length === 2 ? Fit.Internationalization.Locale() : Fit.Internationalization.Locale().substring(0, 2);
		var lang = Fit.Array.Contains(langSupport, localeCode) === true ? localeCode : "en";
		var plugins = [];
		var toolbar = [];
		var mentions = [];

		var config = designEditorConfig || {};

		// Enable additional plugins not compiled into CKEditor by default

		if ((config.Plugins && config.Plugins.Emojis === true) || (config.Toolbar && config.Toolbar.Emojis === true))
		{
			Fit.Array.Add(plugins, "emoji");
		}

		if (designModeEnableImagePlugin() === true)
		{
			if (config.Toolbar && config.Toolbar.Images === true)
			{
				Fit.Array.Add(plugins, "base64image");
			}

			plugins = Fit.Array.Merge(plugins, ["base64imagepaste", "dragresize"]);
		}

		Fit.Array.Add(plugins, "custombuttons");

		// Add toolbar buttons

		if (!config.Toolbar || config.Toolbar.Formatting !== false)
		{
			Fit.Array.Add(toolbar,
			{
				name: "BasicFormatting",
				items: [ "Bold", "Italic", "Underline" ]
			});
		}

		if (!config.Toolbar || config.Toolbar.Justify !== false)
		{
			Fit.Array.Add(toolbar,
			{
				name: "Justify",
				items: [ "JustifyLeft", "JustifyCenter", "JustifyRight" ]
			});
		}

		if (!config.Toolbar || config.Toolbar.Lists !== false)
		{
			Fit.Array.Add(toolbar,
			{
				name: "Lists",
				items: [ "NumberedList", "BulletedList", "Indent", "Outdent" ]
			});
		}

		if (!config.Toolbar || config.Toolbar.Links !== false)
		{
			Fit.Array.Add(toolbar,
			{
				name: "Links",
				items: [ "Link", "Unlink" ]
			});
		}

		if (config.Toolbar)
		{
			var insert = [];

			if (config.Toolbar.Emojis === true)
			{
				Fit.Array.Add(insert, "EmojiPanel");
			}

			if (config.Toolbar.Images === true)
			{
				Fit.Array.Add(insert, "base64image");
			}

			if (config.Toolbar.Tables === true)
			{
				Fit.Array.Add(insert, "Table");
			}

			if (insert.length > 0)
			{
				Fit.Array.Add(toolbar,
				{
					name: "Insert",
					items: insert
				});
			}

			var customButtons = [];
			var customToolbarGroups = [];

			if (config.Toolbar.Detach === true)
			{
				Fit.Array.Add(customButtons,
				{
					Label: locale.Detach,
					Command: "Detach",
					Icon: Fit.GetUrl() + "/Controls/Input/" + (window.devicePixelRatio === 2 ? "maximize-highres.png" : "maximize.png"),
					Callback: function(args)
					{
						//console.log("Command " + args.Command.name + " executed", args);
						openDetachedDesignEditor();
					}
				});

				/*Fit.Array.Add(customButtons,
				{
					Label: "Testing 1-2-3",
					Command: "TestButton",
					Icon: "/files/images/Bird.png",
					Callback: function(args)
					{
						alert("Hello world");
					}
				});*/

				Fit.Array.Add(customToolbarGroups,
				{
					name: "DetachableEditor",
					items: ["Detach"/*, "TestButton"*/]
				});
			}

			toolbar = Fit.Array.Merge(toolbar, customToolbarGroups);
		}

		// Configure tags/mentions plugin

		if (config.Tags)
		{
			var requestAwaiting = null;

			var createEventArgs = function(marker, query, request) // EventsArgs for OnRequest and OnResponse
			{
				return { Sender: me, Query: { Marker: marker, Query: query }, Request: request };
			};

			Fit.Array.ForEach(config.Tags.Triggers, function(trigger)
			{
				var mention =
				{
					marker: trigger.Marker,
					minChars: trigger.MinimumCharacters || 0,
					pattern: trigger.Pattern,
					throttle: 0, // Throttling is not debouncing - it merely ensures that no more than 1 request is made every X milliseconds when value is changed (defaults to 200ms) - real debouncing implemented further down, which reduce and cancel network calls as user types - also a work around for https://github.com/ckeditor/ckeditor4/issues/5036
					feed: function(args, resolve)
					{
						// WebService is expected to return tag items in an array like so:
						// [ { Title: string, Value: string, Icon?: string, Url?: string, Data?: string }, { ... }, ... ]

						var req = null;

						if (config.Tags.JsonpCallback)
						{
							req = new Fit.Http.JsonpRequest(config.Tags.QueryUrl, config.Tags.JsonpCallback);
							config.Tags.JsonpTimeout && req.Timeout(config.Tags.JsonpTimeout);
							req.SetParameter("Marker", args.marker);
							req.SetParameter("Query", args.query);
						}
						else
						{
							req = new Fit.Http.JsonRequest(config.Tags.QueryUrl);
							req.SetData({ Marker: args.marker, Query: args.query });
						}

						if (config.Tags.OnRequest)
						{
							var eventArgs = createEventArgs(args.marker, args.query, req);

							if (config.Tags.OnRequest(me, eventArgs) === false)
							{
								resolve([]);
								return;
							}

							if (eventArgs.Request !== req)
							{
								// Support for changing request instans to
								// take control over webservice communication.

								// Restrict to support for Fit.Http.Request or classes derived from this
								Fit.Validation.ExpectInstance(eventArgs.Request, Fit.Http.Request);

								req = eventArgs.Request;
							}
						}

						var processDataAndResolve = function(items)
						{
							if (config.Tags.OnResponse) // OnResponse is allowed to manipulate tags
							{
								var eventArgs = Fit.Core.Merge(createEventArgs(args.marker, args.query, req), { Tags: items });
								config.Tags.OnResponse(me, eventArgs);

								items = eventArgs.Tags; // In case OnResponse event handler assigned new collection
							}

							Fit.Array.ForEach(items, function(item)
							{
								// Set properties required by mentions plugin
								item.id = item.Value;
								item.name = item.Title;
							});

							resolve(items); // Opens context menu immediately if array contain elements, unless user managed to add a space after the search value while waiting for a response, in which case the context menu will not be opened

							if (items.length > 0)
							{
								// Calling resolve(..) above immediately opens the context menu from which a tag can be selected

								// Get the autocomplete context menu currently open. There can be only one
								// such menu open at any time. Each editor can declare multiple autocomplete
								// context menus since each tag marker is associated with its own context menu.
								var ctm = document.querySelector("ul.cke_autocomplete_opened");

								if (ctm !== null) // Null if user managed to enter a space after tag search value, before response was received - in this case resolve(..) above will not open the context menu
								{
									// Allow light dismissable panels/callouts to prevent close/dismiss
									// when interacting with tags context menu hosted outside of these panels/callouts,
									// by detecting the presence of the data-disable-light-dismiss="true" attribute.
									Fit.Dom.Data(ctm, "disable-light-dismiss", "true");

									if (Fit._internal.ControlBase.ReduceDocumentRootPollution === true)
									{
										// Tags context menu is placed in the root of the document where
										// it pollutes the global scope. Move it next to the Fit.UI control.
										// We do not mount it within the Fit.UI control as it could cause Fit.UI styles
										// to take effect on the context menu.

										// Has position:absolute by default, but this may be affected by a positioned
										// container (offsetParent), so we change it to position:fixed. Downside:
										// It no longer sticks to the editor when scrolling. However, if a container has CSS
										// transform set, the context menu's position will be affected and become inaccurate.
										ctm.style.position = "fixed";
										Fit.Dom.InsertAfter(me.GetDomElement(), ctm);
									}
								}
							}
						};

						if (Fit.Core.InstanceOf(req, Fit.Http.JsonpRequest) === true)
						{
							req.OnSuccess(function(sender)
							{
								var response = req.GetResponse();
								var items = ((response instanceof Array) ? response : []);

								processDataAndResolve(items);
							});

							req.OnTimeout(function(sender)
							{
								resolve([]);
								Fit.Validation.ThrowError("Unable to get tags - request did not return data in time (JSONP timeout reached)");
							});
						}
						else
						{
							req.OnSuccess(function(sender)
							{
								var response = req.GetResponseJson();
								var items = ((response instanceof Array) ? response : []);

								processDataAndResolve(items);
							});

							req.OnFailure(function(sender)
							{
								resolve([]);
								Fit.Validation.ThrowError("Unable to get tags - request failed with HTTP Status code " + req.GetHttpStatus());
							});
						}

						if (requestAwaiting !== null)
						{
							requestAwaiting.Abort();
						}

						requestAwaiting = req;
						req.Start();
					},
					itemTemplate: function(item) // Item must define "name" and "id" properties - the {name} placeholder is replaced by "@" + the value of the "name" property - to get rid of "@" simply use an alternative property such as nameWithoutTag:"Some username"
					{
						if (item.Icon)
						{
							var imageWidth = "24px";
							var spacingWidth = "5px";
							var spanWidthCss = isIe8 === true ? "width: 165px" : "width: calc(100% - " + imageWidth + " - " + spacingWidth + ")"; // We are using fixed dimensions on IE8 (see Input.css)

							return '<li data-id="' + item.Value + '"><img src="' + item.Icon + '" style="width: ' + imageWidth + '; height: ' + imageWidth + '; border-radius: ' + imageWidth + '; vertical-align: middle" alt=""><span style="display: inline-block; box-sizing: border-box; ' + spanWidthCss + '; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; vertical-align: middle; margin-left: ' + spacingWidth + '">' + item.Title + '</span></li>';
						}
						else
						{
							return '<li data-id="' + item.Value + '"><span style="display: inline-block; box-sizing: border-box; width: 100%">' + item.Title + '</span></li>';
						}
					},
					outputTemplate: function(item)
					{
						// IMPORTANT: Output produced must respect ACF (Advanced Content Filter).
						// So the tag produced must be allowed, and any attributes contained must be allowed.

						var alternativeItem = null;

						if (config.Tags.TagCreator)
						{
							var callbackArgs = { Sender: me, QueryMarker: trigger.Marker, Tag: Fit.Core.Clone(item) };
							alternativeItem = config.Tags.TagCreator(me, callbackArgs) || null;
						}

						// Function should return a link for tags to "just work". Returning a <span> requires the span to be whitelisted in
						// extraAllowedContent configuration, but even then the editor will continue writing text within the <span> element,
						// rather than next to it. So one would expect something like: We will assign <span data-tag-type="@" ..>@James Bond</span> to this mission.
						// But what we get instead is something like: We will assign <span data-tag-type="@" ..>@James Bond to this mission</span>.
						// The same happens to link tags if the href attribute is removed, which is why we always add it, even when no URL is defined.

						if (alternativeItem !== null)
						{
							return '<a data-tag-type="' + (alternativeItem.Type || trigger.Marker) + '" data-tag-id="' + (alternativeItem.Value || item.Value) + '"' + (alternativeItem.Data || item.Data ? ' data-tag-data="' + (alternativeItem.Data || item.Data) + '"' : '') + (alternativeItem.Context || item.Context ? ' data-tag-context="' + (alternativeItem.Context || item.Context) + '"' : '') + (alternativeItem.Url || item.Url ? ' href="' + (alternativeItem.Url || item.Url) + '"' : 'href=""') + '>' + (alternativeItem.Title || (trigger.Marker + item.Title)) + '</a>&nbsp;';
						}
						else
						{
							return '<a data-tag-type="' + trigger.Marker + '" data-tag-id="' + item.Value + '"' + (item.Data ? ' data-tag-data="' + item.Data + '"' : '') + (item.Context ? ' data-tag-context="' + item.Context + '"' : '') + (item.Url ? ' href="' + item.Url + '"' : 'href=""') + '>' + trigger.Marker + item.Title + '</a>&nbsp;';
						}
					}
				};

				if (trigger.DebounceQuery !== 0) // A value of 0 (zero) disables debouncing
				{
					// Wrap feed handler in debounce function so that every time it gets invoked, it cancels the previous invocation
					mention.feed = Fit.Core.CreateDebouncer(mention.feed, trigger.DebounceQuery || 300).Invoke;
				}

				Fit.Array.Add(mentions, mention);
			});
		}

		var onImageAdded = function(args)
		{
			if (args.type === "blob")
			{
				// For a list of blobs in Chrome see: chrome://blob-internals/
				// Be aware that garbage is NOT being collected unless needed, so
				// don't expect the list to update immediately. Garbage collection
				// can be triggered in Dev Tools > Memory: click the trash can icon.
				// Make sure to garbage collect from the tab/window running Fit.UI,
				// NOT from the tab/window listing blobs!
				// Use https://jsfiddle.net/ute87p1m/6/ to test garbage collection.

				imageBlobUrls.push(args.url);
			}

			/*// Image data can be retrieved from a blob like this:
			if (img.src.indexOf("blob:") === 0)
			{
				var r = new Fit.Http.Request(img.src); // E.g. "blob:http://localhost:8080/0c5aa2ae-f2ea-414a-af42-53047959ad1b"
				r.RequestProperties({ responseType: "blob" });
				r.OnSuccess(function(sender)
				{
					var blob = sender.GetResponse();

					var reader = new FileReader();
					reader.onload = function(ev)
					{
						var base64 = ev.target.result;
						console.log(base64);
					};
					reader.readAsDataURL(blob);
				});
				r.Start();
			}*/
		};

		// How disallowedContent works is described here: https://ckeditor.com/docs/ckeditor4/latest/guide/dev_disallowed_content.html
		// How the rules work is covered in more details here: https://ckeditor.com/docs/ckeditor4/latest/guide/dev_allowed_content_rules.html
		// Format in short: element[allowed/disallowed attributes]{allowed/disallowed styles}(allowed/disallowed classes)
		// Allowed and disallowed elements, attributes, styles, and classes can be revealed runtime using:
		//     CKEDITOR.instances['<Instance ID>'].filter.allowedContent
		//     CKEDITOR.instances['<Instance ID>'].filter.disallowedContent
		// Use the following code to check whether given content is allowed or not based on allowedContent and disallowedContent:
		//     CKEDITOR.instances['<Instance ID>'].filter.check("element[attributes]{styles}(classes)");
		// Be aware that disallowing e.g. border* works even though e.g. check("td{border}") returns true, incorrectly indicating that it is allowed.
		// Being more specific using e.g. check("td{border-style}") causes it to return false as expected, correctly indicating that it is not allowed.
		var disallowedContent = "";

		// Undo from allowedContent in table plugin: https://github.com/ckeditor/ckeditor4/blob/4df6984595e3b73de61cd2a1b1a7ec823f9cfbdc/plugins/table/plugin.js#L21C21-L21C102
		//disallowedContent += (disallowedContent !== "" ? ";" : "") + "table[align,cellpadding,cellspacing]{*}"; // Remove all attributes except border and summary

		// Undo from allowedContent in tabletools plugin: https://github.com/ckeditor/ckeditor4/blob/4df6984595e3b73de61cd2a1b1a7ec823f9cfbdc/plugins/tabletools/plugin.js#L820
		// and from table plugin: https://github.com/ckeditor/ckeditor4/blob/4df6984595e3b73de61cd2a1b1a7ec823f9cfbdc/plugins/table/plugin.js#L24C1-L25C1
		//disallowedContent += (disallowedContent !== "" ? ";" : "") + "td th{background-color,border*,height,vertical-align,white-space,width}"; // Remove all CSS properties except text-align - retains all attributes (colspan, rowspan)

		designEditor = CKEDITOR.replace(me.GetId() + "_DesignMode",
		{
			toolbarLocation: designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.Position === "Bottom" ? "bottom" : "top",
			uiColor: Fit._internal.Controls.Input.Editor.Skin === "moono-lisa" || Fit._internal.Controls.Input.Editor.Skin === null ? "#FFFFFF" : undefined,
			//allowedContent: true, // http://docs.ckeditor.com/#!/guide/dev_allowed_content_rules and http://docs.ckeditor.com/#!/api/CKEDITOR.config-cfg-allowedContent
			extraAllowedContent: "a[data-tag-type,data-tag-id,data-tag-data,data-tag-context]", // https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_config.html#cfg-extraAllowedContent
			disallowedContent: disallowedContent,
			language: lang,
			disableNativeSpellChecker: me.CheckSpelling() === false,
			readOnly: me.Enabled() === false,
			tabIndex: me.Enabled() === false ? -1 : 0,
			title: "",
			width: "100%", // Assume width of container
			height: me.Height().Value > -1 ? me.Height().Value + me.Height().Unit : "100%", // Height of content area - toolbar and bottom panel takes up additional space - once editor is loaded, the outer dimensions are accurately set using updateDesignEditorSize() - a height of 100% enables auto grow
			startupFocus: me.Focused() === true ? "end" : false, // Doesn't work when editor is hidden while initializing to avoid flickering - focus is set again when editor is made visible in instanceReady handler, at which point it will place cursor at the end of the editor if startupFocus is set to "end"
			extraPlugins: plugins.join(","),
			clipboard_handleImages: false, // Disable native support for image pasting - allow base64imagepaste plugin to handle image data if loaded
			base64image: // Custom property used by base64image plugin if loaded
			{
				storage: designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.EmbedType === "blob" ? "blob" : "base64", // "base64" (default) or "blob" - base64 will always be provided by browsers not supporting blob storage
				onImageAdded: onImageAdded
			},
			base64imagepaste: // Custom property used by base64imagepaste plugin if loaded - notice that IE has native support for image pasting as base64 so plugin is not triggered in IE
			{
				storage: designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.EmbedType === "blob" ? "blob" : "base64", // "base64" (default) or "blob" - base64 will always be provided by browsers not supporting blob storage
				onImageAdded: onImageAdded
			},
			resize_enabled: resizable !== Fit.Controls.InputResizing.Disabled,
			resize_dir: resizable === Fit.Controls.InputResizing.Enabled ? "both" : resizable === Fit.Controls.InputResizing.Vertical ? "vertical" : resizable === Fit.Controls.InputResizing.Horizontal ? "horizontal" : "none", // Specific to resize plugin (horizontal | vertical | both - https://ckeditor.com/docs/ckeditor4/latest/features/resize.html)
			toolbar: toolbar,
			removeButtons: "", // Set to empty string to prevent CKEditor from removing buttons such as Underline
			customButtons: customButtons,
			mentions: mentions,
			emoji_minChars: 9999, // Impossible requirement to number of search characters to "disable" emoji auto complete menu - we cannot make it work properly with light dismissable panels/callouts since we have no event available for registering the data-disable-light-dismiss="true" attribute, and it's not very useful in any case
			on:
			{
				instanceReady: function()
				{
					designEditorDom = // Object assignment will make designModeEnabledAndReady() return True, so it must be assigned immediately
					{
						OuterContainer: designEditor.container.$,
						InnerContainer: designEditor.container.$.querySelector(".cke_inner"),
						Top: designEditor.container.$.querySelector(".cke_top"), // Null if toolbar is placed at the bottom
						Content: designEditor.container.$.querySelector(".cke_contents"),
						Editable: designEditor.container.$.querySelector(".cke_editable"),
						Bottom: designEditor.container.$.querySelector(".cke_bottom") // Only exist if editor is resizable or toolbar is placed at the bottom
					}

					// Make sure expected DOM elements are present, so we do not have to perform null checks anywhere else in the code.
					// Notice that designEditorDom.Top is null if toolbar is placed at the bottom, and designEditorDom.Bottom is null
					// unless toolbar is placed at the bottom, or editor is resizable, which adds a resize handled in the lower right corner.
					if (designEditorDom.InnerContainer === null || designEditorDom.Content === null || designEditorDom.Editable === null || (designEditorDom.Top === null && designEditorDom.Bottom === null))
					{
						throw "One or more editor DOM elements are missing"; // This should only happen if CKEditor changes its DOM structure
					}

					if (designEditorMustDisposeWhenReady === true)
					{
						Fit.Browser.Debug("WARNING: Input control '" + me.GetId() + "' was disposed while initializing DesignMode - now resuming disposal");
						me.Dispose();
						return;
					}

					if (designEditorMustReloadWhenReady === true)
					{
						Fit.Browser.Debug("WARNING: Editor for Input control '" + me.GetId() + "' finished loading, but properties affecting editor has changed while initializing - reloading to adjust to changes");
						reloadEditor(true);
						return;
					}

					// Make links in editor clickable in combination with CTRL/META/SHIFT
					var mouseOver = false;
					Fit.Events.AddHandler(designEditorDom.Editable, "mouseover", function(e)
					{
						mouseOver = true;
						Fit.Dom.Data(designEditorDom.Editable, "command-button-active", (e.ctrlKey === true || e.metaKey === true || e.shiftKey === true) && "true" || null);
					});
					Fit.Events.AddHandler(designEditorDom.Editable, "mouseout", function(e)
					{
						mouseOver = false;
						Fit.Dom.Data(designEditorDom.Editable, "command-button-active", null);
					});
					designEditorGlobalKeyDownEventId = Fit.Events.AddHandler(document, "keydown", function(e)
					{
						mouseOver && Fit.Dom.Data(designEditorDom.Editable, "command-button-active", (e.ctrlKey === true || e.metaKey === true || e.shiftKey === true) && "true" || null);
					});
					designEditorGlobalKeyUpEventId = Fit.Events.AddHandler(document, "keyup", function(e)
					{
						mouseOver && Fit.Dom.Data(designEditorDom.Editable, "command-button-active", null);
					});
					Fit.Events.AddHandler(designEditorDom.Editable, "mousedown", function(e) // Using OnMouseDown to make sure click is registered before control gains focus if not already focused (using me.Focused() in event handler)
					{
						var target = Fit.Events.GetTarget(e);

						// Notice that target.href is computed - it is always a fully qualified URL. For an empty href attribute the href property
						// will point to the current page URL, and for a relative URL in the href attribute the href property is combined with the
						// current page URL, also forming a fully qualified URL.

						if (target.tagName === "A" && Fit.Dom.Attribute(target, "href") !== "")
						{
							if (e.ctrlKey === true || e.metaKey === true)
							{
								window.open(target.href);
							}
							else if (e.shiftKey === true)
							{
								window.open(target.href, "_blank");
							}
							else
							{
								var editorInactive = me.Focused() === false && designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.HideWhenInactive === true;

								if (me.Enabled() === false || editorInactive === true)
								{
									var popupCode = Fit.Dom.Data(target, "cke-pa-onclick");

									if (popupCode !== null) // Popup window link - example code: window.open(this.href, "name", "options"); return false;
									{
										popupCode = popupCode.replace("this.href", "'" + target.href + "'"); // Insert link URL
										popupCode = popupCode.replace("return false;", ""); // Remove return statement which is illegal in eval(..)

										eval(popupCode);
									}
									else
									{
										window.open(target.href, editorInactive === true ? "_blank" : Fit.Dom.Attribute(target, "target") || "_self");
									}
								}
							}
						}
					});

					removeCkeSavedSrcAttributesFromDesignEditor();

					updateDesignEditorPlaceholder(); // Show/hide placeholder - value might have been set/removed while initializing editor

					Fit.Dom.Data(designEditorDom.OuterContainer, "skin", CKEDITOR.config.skin); // Add e.g. data-skin="bootstrapck" to editor - used in Input.css

					// Enabled state might have been changed while loading.
					// Unfortunately there is no API for changing the tabIndex.
					// Similar logic is found in Enabled(..) function.
					designEditor.setReadOnly(me.Enabled() === false);
					Fit.Dom.Attribute(designEditorDom.Editable, "tabindex", me.Enabled() === false ? null : "0"); // Preventing focus is only possible by nullifying DOM attribute (these does not work: delete elm.tabIndex; elm.tabIndex = null|undefined|-1)

					if (me.Height().Value === -1 || (designEditorConfig !== null && designEditorConfig.AutoGrow && designEditorConfig.AutoGrow.Enabled === true))
					{
						// Enable auto grow - this is done late to allow an initial static height on the outer control which prevents "flickering" while loading

						me.Height(-1); // Make sure auto grow is enabled since it is unlikely external code has done so explicitely by calling Height(-1)

						// Make necessary adjustments to editor DOM for auto grow's min/max height to work

						var editableDiv = designEditorDom.Editable;
						editableDiv.style.minHeight = designEditorConfig !== null && designEditorConfig.AutoGrow && designEditorConfig.AutoGrow.MinimumHeight ? designEditorConfig.AutoGrow.MinimumHeight.Value + (designEditorConfig.AutoGrow.MinimumHeight.Unit || "px") : ""; // NOTICE: Minimum height of editable area, not control
						editableDiv.style.maxHeight = designEditorConfig !== null && designEditorConfig.AutoGrow && designEditorConfig.AutoGrow.MaximumHeight ? designEditorConfig.AutoGrow.MaximumHeight.Value + (designEditorConfig.AutoGrow.MaximumHeight.Unit || "px") : ""; // NOTICE: Maximum height of editable area, not control

						// Restrict resizing:
						// Make sure user cannot resize editor beyond max height of editable area.
						// Editable area will not "follow" since it is restricted using maxHeight set above.
						// If we do not want resizing to be restricted, then unset minHeight and maxHeight set
						// above, when resizing occur (see CKEditor's resize event handler).
						if (editableDiv.style.maxHeight !== "" && designEditorConfig.AutoGrow.PreventResizeBeyondMaximumHeight === true)
						{
							var contents = designEditorDom.Content;
							contents.style.maxHeight = editableDiv.style.maxHeight;
						}
					}

					if (me.Height().Value !== -1 && me.Height().Unit === "%")
					{
						enableDesignEditorHeightMonitor(true); // Enable support for relative height
					}

					if (designEditorConfig !== null && designEditorConfig.InfoPanel && designEditorConfig.InfoPanel.Text)
					{
						var infoPanel = document.createElement("div");
						infoPanel.className = "FitUiControlInputInfoPanel";
						infoPanel.innerHTML = designEditorConfig.InfoPanel.Text;
						infoPanel.style.cssText = "text-align: " + (designEditorConfig.InfoPanel.Alignment ? designEditorConfig.InfoPanel.Alignment.toLowerCase() : "center");

						if (designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.Position === "Bottom")
						{
							Fit.Dom.InsertBefore(designEditorDom.Content, infoPanel);
						}
						else
						{
							Fit.Dom.InsertAfter(designEditorDom.Content, infoPanel);
						}
					}

					// Sticky toolbar - compensate for padding in scroll parent

					if (me._internal.Data("toolbar-sticky") === "true")
					{
						var toolbarContainer = designEditorDom.Top || designEditorDom.Bottom;

						if (Fit.Dom.GetComputedStyle(toolbarContainer, "position") === "sticky") // False on non-supported browsers as position:sticky is applied via the @supports CSS rule
						{
							var scrollParent = Fit.Dom.GetScrollParent(me.GetDomElement());

							if (scrollParent !== null) // In case editor is hosted in a container with position:fixed with overflow:hidden, in which case Fit.Dom.GetScrollParent(..) returns null
							{
								var toolbarPosition = me._internal.Data("toolbar-position"); // top | bottom

								if (toolbarPosition === "top")
								{
									var paddingOffset = Fit.Dom.GetComputedStyle(scrollParent, "padding-top"); // E.g. "28px"
									toolbarContainer.style.top = paddingOffset !== "0px" ? "-" + paddingOffset : "";
								}
								else
								{
									var paddingOffset = Fit.Dom.GetComputedStyle(scrollParent, "padding-bottom"); // E.g. "28px"
									toolbarContainer.style.bottom = paddingOffset !== "0px" ? "-" + paddingOffset : "";
								}
							}
						}
					}

					// Register necessary events with emoji panel when opened

					var emojiButton = designEditor.container.$.querySelector("a.cke_button__emojipanel");

					if (emojiButton !== null) // Better safe than sorry
					{
						Fit.Events.AddHandler(emojiButton, "click", function(e)
						{
							// Make sure OnFocus fires before locking focus state

							if (me.Focused() === false)
							{
								// Control not focused - make sure OnFocus fires when emoji button is clicked,
								// and make sure ControlBase internally considers itself focused, so there is
								// no risk of OnFocus being fired twice without OnBlur firing in between,
								// when focus state is unlocked, and focus is perhaps re-assigned to another
								// DOM element within the control, which will be the case if the design editor
								// is switched back to an ordinary input field (e.g. using DesignMode(false)).
								me.Focused(true);
							}

							// Prevent control from firing OnBlur when emoji dialog is opened.
							// Notice that locking the focus state will also prevent OnFocus
							// from being fired automatically.
							me._internal.FocusStateLocked(true);

							setTimeout(function() // Postpone - emoji panel is made visible after click event
							{
								// Allow light dismissable panels/callouts to prevent close/dismiss
								// when interacting with emoji widget hosted outside of panels/callouts,
								// by detecting the presence of a data-disable-light-dismiss="true" attribute.
								var emojiPanel = document.querySelector("div.cke_emoji-panel"); // Shared among instances

								if (emojiPanel !== null) // Better safe than sorry
								{
									Fit.Dom.Data(emojiPanel, "disable-light-dismiss", "true");

									emojiPanel._associatedFitUiControl = me;

									designEditorActiveToolbarPanel =
									{
										DomElement: emojiPanel,
										UnlockFocusStateIfEmojiPanelIsClosed: function() // Function called regularly via interval timer while emoji panel is open to make sure focus state is unlocked when emoji panel is closed, e.g. by pressing ESC, clicking outside of emoji panel, or by choosing an emoji
										{
											if (designModeEnabledAndReady() === false /* No longer in DesignMode */ || Fit.Dom.IsVisible(emojiPanel) === false /* Emoji panel closed */ || emojiPanel._associatedFitUiControl !== me /* Emoji panel now opened from another editor */)
											{
												designEditorActiveToolbarPanel = null;

												// Disable focus lock - let ControlBase handle OnFocus and OnBlur automatically again
												me._internal.FocusStateLocked(false);

												// Fire OnBlur in case user changed focus while emoji panel was open.
												// OnBlur does not fire automatically when focus state is locked.
												if (me.Focused() === false)
												{
													me._internal.FireOnBlur();
												}
											}
										},
										CloseEmojiPanel: function()
										{
											if (emojiPanel._associatedFitUiControl === me && Fit.Dom.IsVisible(emojiPanel) === true && Fit.Dom.Contained(emojiPanel, Fit.Dom.GetFocused()) === true)
											{
												designEditor.focus();
												designEditorActiveToolbarPanel.UnlockFocusStateIfEmojiPanelIsClosed();
											}
										}
									}
								}

								// Hide status bar in emoji dialog
								var emojiFrame = emojiPanel.querySelector("iframe");
								var emojiContent = emojiFrame && emojiFrame.contentDocument;
								var emojiContentBlock = emojiContent && emojiContent.querySelector(".cke_emoji-outer_emoji_block");
								var emojiContentStatus = emojiContent && emojiContent.querySelector(".cke_emoji-status_bar");
								emojiContentBlock && (emojiContentBlock.style.height = "220px");
								emojiContentStatus && (emojiContentStatus.style.display = "none");

								var checkClosedId = setInterval(function()
								{
									// Invoke cleanup function regularly to make sure
									// focus lock is relased when emoji panel is closed,
									// and to fire OnBlur if another control was focused
									// while emoji panel was open.

									if (me === null)
									{
										clearInterval(checkClosedId);
										return;
									}

									if (designEditorActiveToolbarPanel !== null)
									{
										designEditorActiveToolbarPanel.UnlockFocusStateIfEmojiPanelIsClosed(); // Nullfies designEditorActiveToolbarPanel if emoji panel is closed
									}

									if (designEditorActiveToolbarPanel === null)
									{
										clearInterval(checkClosedId);
									}
								}, 250);
							}, 0);
						});
					}

					// DISABLED: Doesn't work! Emoji panel contains an iFrame. When it is re-mounted
					// in DOM, the iframe reloads, and dynamically added content is lost. Also, this makes
					// CKEditor throw errors and the dialog never appears.
					/*if (Fit._internal.ControlBase.ReduceDocumentRootPollution === true)
					{
						// Move emoji dialog to control - otherwise placed in the root of the document where it pollutes,
						// and makes it impossible to interact with the dialog in light dismissable panels and callouts.
						// Dialog is placed alongside control and not within the control's container, to prevent Fit.UI
						// styling from affecting the dialog.
						if (config.Toolbar && config.Toolbar.Emojis === true)
						{
							var emojiButton = designEditor.container.$.querySelector("a.cke_button__emojipanel");

							if (emojiButton !== null)
							{
								Fit.Events.AddHandler(emojiButton, "click", function(e)
								{
									setTimeout(function() // Postpone - made visible after click event
									{
										var emojiPanel = document.querySelector("div.cke_emoji-panel:not([style*='display: none'])");

										if (emojiPanel !== null)
										{
											Fit.Dom.InsertAfter(me.GetDomElement(), emojiPanel);
										}
									}, 0);
								});
							}
						}
					}*/

					// Remove buggy cut/copy/paste operations from ContextMenu.
					// Related issue: https://github.com/ckeditor/ckeditor4/issues/469
					// NOTICE: ContextMenu will not show up when empty - it won't
					// even open the browser's own ContextMenu in this case. We work
					// around this by suppressing CKEditor's ContextMenu using the
					// "contextmenu" event registered in init().
					designEditor.removeMenuItem("cut");
					designEditor.removeMenuItem("copy");
					designEditor.removeMenuItem("paste");

					// Make editor assume configured width and height.
					// Notice that using config.width and config.height
					// (https://ckeditor.com/docs/ckeditor4/latest/features/size.html)
					// results in editor becoming too high since the toolbar height is not
					// substracted. This problem does not occur when using updateDesignEditorSize().
					updateDesignEditorSize();

					if (me.Focused() === false)
					{
						// Hide editor toolbar if configured to do so
						hideToolbarInDesignMode();
					}
					/*else
					{
						// Remove placeholder if initially focused
						updateDesignEditorPlaceholder(true);
					}*/

					// Make editor visible - postpone to allow editor to first calculate auto grow height
					// so the user will not see the chrome (borders) of the editor increase its height.
					setTimeout(function()
					{
						designEditorDom.OuterContainer.style.visibility = "visible";

						// Because editor is hidden while initializing, startupFocus
						// (https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_config.html#cfg-startupFocus)
						// won't be able to place focus in the editor. We resolve this by assigning focus again
						// once editor is visible (visibility set above). Because startupFocus was set, it will
						// place focus at the end of the editor as expected.
						if (me.Focused() === true)
						{
							designEditor.focus(); // Won't work on iOS as assigning focus must be the result of a direct user interaction, which this is not since it is postponed using setTimeout(..) and async. loading of the editor
						}
					}, 0);
				},
				change: function() // CKEditor bug: not fired in Opera 12 (possibly other old versions as well)
				{
					if (designEditorCleanEditableDom === true)
					{
						removeCkeSavedSrcAttributesFromDesignEditor();
					}

					if (me._internal.FireOnChangeSuppressed === true)
					{
						// Do not process event - it has been fired by CKEditor when HTML
						// value was initially assigned in Value(..) which happend through
						// me._internal.ExecuteWithNoOnChange(function() { .. }).
						// See Value(..) implementation for details.
						return;
					}

					// Assume value was changed by user if control has focus
					if (designEditorDirty === false && me.Focused() === true)
					{
						designEditorDirty = true;
					}

					input.onkeyup();
				},
				resize: function() // Fires when size is changed (except via auto grow), not just when resized using resize handle in lower right cornor
				{
					if (designEditorSuppressOnResize === false) // Only set data-resized="true" when resized using resize handle
					{
						designEditorDom.Editable.style.height = ""; // Disable fixed height set if toolbar was hidden/displayed at some point (see hideToolbarInDesignMode() and restoreHiddenToolbarInDesignEditor())

						// Disable Min/Max height configured with auto grow feature so user can resize it freely, unless PreventResizeBeyondMaximumHeight is enabled
						if (designEditorConfig !== null && designEditorConfig.AutoGrow && designEditorConfig.AutoGrow.Enabled === true && designEditorConfig.AutoGrow.PreventResizeBeyondMaximumHeight !== true)
						{
							var editableDiv = designEditorDom.Editable;
							editableDiv.style.minHeight = "";
							editableDiv.style.maxHeight = "";

							var contents = designEditorDom.Content;
							contents.style.maxHeight = "";
						}

						me._internal.Data("resized", "true");
						repaint();
					}
				},
				selectionChange: function(ev)
				{
					var elm = ev.data.selection.getStartElement().$;

					// Allow light dismissable panels/callouts to prevent close/dismiss
					// when interacting with image resize handles hosted outside of panels/callouts,
					// by detecting the presence of a data-disable-light-dismiss="true" attribute.

					if (elm.tagName === "IMG")
					{
						setTimeout(function() // Postpone - wait for image resize plugin to add image resize handles
						{
							var imageResizeHandlesContainer = document.querySelector("#ckimgrsz");
							if (imageResizeHandlesContainer !== null) // Better safe than sorry
							{
								Fit.Dom.Data(imageResizeHandlesContainer, "disable-light-dismiss", "true");
							}
						}, 0);
					}

					// Disable/enable toolbar buttons, depending on whether a tag/mention is selected

					if (elm.tagName === "A" && Fit.Dom.Data(elm, "tag-id") !== null)
					{
						// Notice that selectionChange handler is invoked while editor is loading if control was given initial focus.
						// But at this point the toolbar buttons are not yet available to be disabled, so disableDesignEditorButtons()
						// won't work. However, as soon as the editor is done loading, focus is re-assigned to the editable area
						// which will trigger selectionChange handler once again, at which point designModeEnabledAndReady() returns true.
						if (designModeEnabledAndReady() === true)
						{
							designEditorSuppressPaste = true;
							setTimeout(function() // Postpone - otherwise we won't be able to temporarily disable some of the buttons (https://jsfiddle.net/ymv56znq/14/)
							{
								disableDesignEditorButtons();
							}, 0);
						}
					}
					else
					{
						designEditorSuppressPaste = false;
						restoreDesignEditorButtons();
					}
				},
				doubleclick: function(ev)
				{
					// Suppress link dialog when double clicking. User must use link
					// button instead which triggers beforeCommandExec below - it creates
					// a focus lock to prevent control from losing focus and firing OnBlur.
					if (ev.data.element.$.tagName === "A")
					{
						ev.cancel();
						return;
					}

					// Suppress link dialog for tags (similar code found in beforeCommandExec handler below)
					// DISABLED: No longer needed since link dialog is now suppressed for all links (see code above)
					/*if (Fit.Dom.Data(ev.data.element.$, "tag-id") !== null)
					{
						ev.cancel();
						return;
					}*/
				},
				paste: function(ev)
				{
					var html = ev.data.dataValue;

					// Fix line breaks in image alt attributes generated by Word (at least on Mac).
					// Word automatically decodes the nature of an image, and adds a suitable description
					// such as "Girl walking a dog\n\nDescription automatically generated". Notice line breaks.
					var imageTags = html.match(/<img [^>]+?>/g);
					var updatedImageTags = [];
					Fit.Array.ForEach(imageTags || [], function(imageTag)
					{
						var updatedImageTag = imageTag.replace(/\n/g, " ");
						html = html.replace(imageTag, updatedImageTag);
						updatedImageTags.push(updatedImageTag);
					});

					// Image paste plugin does not handle pasting of mixed content (text and images).
					// For Word specifically, this results in images being added as inline base64 images.
					// When copying text and images from browsers, external image references are added instead.
					// Convert base64 images from Word into image blobs on supported browsers if blob storage is enabled.
					if (designEditorConfig !== null && designEditorConfig.Plugins && designEditorConfig.Plugins.Images && designEditorConfig.Plugins.Images.EmbedType === "blob" && window.URL && window.URL.createObjectURL)
					{
						var dataUrlRegEx = /<img.*? src=(["'])(data:image\/[a-z]+;base64,[A-Za-z0-9+\/=]+)\1/; // [ 0 = Full match, 1 = quote type, 2 = Base64 image data URL ][] | null (https://regex101.com/r/r7GhkO/1)

						Fit.Array.ForEach(updatedImageTags, function(img)
						{
							var imageTagWithDataUrl = img.match(dataUrlRegEx);

							if (imageTagWithDataUrl !== null)
							{
								// Convert images synchronously - we need them immediately while paste event is
								// running, so we can manipulate data before it is inserted into CKEditor. If this
								// proves to perform poorly, consider moving the logic to the afterInsertHtml handler.
								// However, we would need to prevent changes to the editor while waiting for conversion to finish.
								Fit.Core.Base64ToBlob(imageTagWithDataUrl[2], null /* get mime type from base64 data */, false /* not async */, function(result)
								{
									if (result.Blob !== null) // Null on failure
									{
										var newImageDataUrl = URL.createObjectURL(result.Blob);
										imageBlobUrls.push(newImageDataUrl);
										html = html.replace(imageTagWithDataUrl[2], newImageDataUrl);
									}
									else
									{
										Fit.Browser.Log("Error converting base64 image to blob: " + result.Error);
									}
								});
							}
						});
					}

					ev.data.dataValue = html;

					// Prevent pasting (especially images) into tags.
					// OnPaste is suppressed using an OnPaste handler in capture phase, which will prevent the operation entirely
					// on supported browsers. On legacy browsers we handle this by invoking undo on the editor instance instead.
					//var path = ev.editor.elementPath(); // Null if dialog button is triggered without placing text cursor in editor first
					//if (Fit.Dom.Data(path.lastElement.$, "tag-id") !== null)
					if (designEditorSuppressPaste === true) // Also handled in a native OnPaste event handler (capture phase) for supported browsers, which suppresses the event entirely
					{
						setTimeout(function() // Postpone - allow editor to create snapshot
						{
							ev.editor.execCommand("undo"); // Undo change - paste event cannot be canceled, as it has already happened
						}, 0);
						return;
					}
				},
				afterInsertHtml: function(ev)
				{
					removeCkeSavedSrcAttributesFromDesignEditor();
				},
				beforeCommandExec: function(ev)
				{
					// Suppress any command (formatting, link dialog etc.) for tags (similar code found in doubleclick handler above).
					// Commmands can be triggered in multiple ways, e.g. using toolbar buttons, using keyboard shortcuts, and programmatically.
					var path = ev.editor.elementPath(); // Null if dialog button is triggered without placing text cursor in editor first
					if (path === null && ev.editor.getData().indexOf("<p><a data-tag-id=") === 0)
					{
						// Text cursor has not been placed in editor, but a command such as Bold or "insert image"
						// has been triggered, and editor content starts with a tag. This results in command being
						// applied to the tag, which we do not want. Usually this is prevented by the toolbar being
						// disabled when a tag is selected (see selectionChange event handler further up), but that
						// is not the case when the user has not yet placed the cursor in the editor.
						ev.cancel();
						return;
					}
					else if (path !== null && Fit.Dom.Data(path.lastElement.$, "tag-id") !== null && ev.data.name !== "undo") // Allow undo within tag, in case user typed something by mistake
					{
						// Cursor is currently placed in a tag - do not allow formatting
						ev.cancel();
						return;
					}

					if (ev && ev.data && ev.data.command && ev.data.command.dialogName)
					{
						// Command triggered was a dialog

						// IE9-IE11 does not fire OnFocus when user clicks a dialog button directly,
						// without placing the text cursor in the editing area first. To avoid this
						// problem, we simply ignore dialog commands if control does not already
						// have focus. We target all versions of IE for consistency.
						if (me.Focused() === false && Fit.Browser.GetBrowser() === "MSIE")
						{
							ev.cancel();
							return;
						}

						// Prevent multiple control instances from opening a dialog at the same time.
						// This is very unlikely to happen, as it requires the second dialog to be
						// triggered programmatically, since a modal layer is immediately placed on top
						// of the page when clicking a button that opens a dialog, preventing additional
						// interaction with editors.
						// Naturally conflicting CSS causing the modal layer to remain hidden could
						// allow the user to trigger multiple dialogs. Better safe than sorry.
						if (Fit._internal.Controls.Input.ActiveEditorForDialog)
						{
							ev.cancel();
							return;
						}

						// Make sure OnFocus fires before locking focus state

						if (me.Focused() === false)
						{
							// Control not focused - make sure OnFocus fires when a button is clicked,
							// and make sure ControlBase internally considers itself focused, so there is
							// no risk of OnFocus being fired twice without OnBlur firing in between,
							// when focus state is unlocked, and focus is perhaps re-assigned to another
							// DOM element within the control, which will be the case if the design editor
							// is switched back to an ordinary input field (e.g. using DesignMode(false)).
							me.Focused(true);
						}

						// Prevent control from firing OnBlur when dialogs are opened.
						// Notice that locking the focus state will also prevent OnFocus
						// from being fired automatically.
						me._internal.FocusStateLocked(true);

						// Make control available to global dialog event handlers which
						// cannot access individual control instances otherwise.

						Fit._internal.Controls.Input.ActiveEditorForDialog = me;	// Editor instance is needed when OnHide event is fired for dialog on global CKEditor instance
						Fit._internal.Controls.Input.ActiveDialogForEditor = null;	// Dialog instance associated with editor will be set when dialog's OnShow event fires
					}
				},
				menuShow: function(ev) // Fires when CKEditor's ContextMenu is opened, and when any sub menus are opened
				{
					me._internal.FocusStateLocked(true);

					if (designEditor.contextMenu.onHide === undefined) // Configure ContextMenu on first use - ContextMenu is shared amoung all editor instances
					{
						var ctxElm = ev.data[0].element.$;

						Fit.Events.AddHandler(ctxElm, "mousedown", true, function(e) // Capture phase (true argument) not supported by IE8 - too bad
						{
							Fit.Events.Stop(e); // Do not trigger click on ContextMenu's border as it triggers onHide and moves focus to <body> rather than editor
						});

						var returningFocus = false;

						designEditor.contextMenu.onHide = function()
						{
							// Quirks and noteworthy details related to CKEditor's ContextMenu and its onHide callback:
							// - ContextMenu is an iFrame which holds focus while open, and fires onHide when it lose focus.
							//   It's actually multiple iframes - one for the root items, and one for the sub items.
							// - ContextMenu is still visible when OnHide fires, and it still holds focus if an element within was clicked with the mouse or selected with the keyboard.
							// - When an item in the ContextMenu is triggered, it returns focus to the editor after OnHide has fired.
							// - When ContextMenu is dismissed (by clicking outside of ContextMenu or by pressing ESC), it moves focus to <body>, which causes Input.Onblur to fire unless suppressed.
							//   Once hidden, focus is moved to the element clicked with the mouse, or to the editor if the ContextMenu was dismissed using ESC.
							// - If the user clicks on the border of the ContextMenu, it doesn't return focus to the editor after temporarily focusing <body>.
							// - The onHide callback fires one time when ContextMenu is dismissed but twice when an item is selected/clicked (see me._internal.FocusStateLocked() check).
							// - The onHide callback is invoked before changes are made in editor, and before dialogs are opened.
							// - Manually re-focusing the editor (me.Focused(true)) during the execution of onHide sometimes result in immediate invocation of onHide again (mitigated using returningFocus check).
							// - ContextMenu is shared amoung all instances of CKEditor.
							// - Sometimes the first right-click triggers the browser's own ContextMenu rather than CKEditor's ContextMenu.
							// - The onHide callback is undocumented API - perhaps for good reasons.

							if (me._internal.FocusStateLocked() === false || returningFocus === true) // Skip redundant invocation - sometimes fired twice (see quirks documented above)
							{
								return;
							}

							var focusedElement = Fit.Dom.GetFocused();
							var contextMenuHasFocus = focusedElement.tagName === "IFRAME" && focusedElement.className.indexOf("cke_panel_frame") !== -1;

							if (contextMenuHasFocus === true) // ContextMenu has focus if use triggered one of the items
							{
								// Make sure focus is returned before focus state is unlocked - otherwise OnFocus will be fired when editor finish modification and returns focus to editor.
								// Calling Focused(true) when triggering a ContextMenu item sometimes causes onHide to fire again immediately - this is the case if triggering e.g. Table properties, but not when triggering e.g. Paste or Delete cell.
								returningFocus = true;
								me.Focused(true);
								returningFocus = false;
							}
							else // ContextMenu does not have focus - user probably clicked in editor or outside of editor to dismiss it
							{
								if (Fit.Dom.GetFocused() === document.body) // ContextMenu returns focus to body when dismissed, even when clicking in editor
								{
									me.Focused(true); // Return focus to editor to prevent Input.OnBlur from firing - once onHide has finished, CKEditor will focus the area clicked - and contrary to Focused(true) above, this does not cause onHide to immediately fire again
								}
								else // If something else (e.g. another control) has been given focus, then don't steal back focus, but fire OnBlur instead
								{
									me._internal.FireOnBlur();
								}
							}

							me._internal.FocusStateLocked(false);
						};

						designEditor.contextMenu.onHide._fitUiCallback = true;
					}
					else if (designEditor.contextMenu.onHide._fitUiCallback !== true) // Make sure we detect if another plugin starts using the onHide callback
					{
						throw "Unexpected use of ContextMenu.onHide event!";
					}
				}
			}
		});
	}

	function disableDesignEditorButtons() // Might be called multiple times, e.g. if navigating from one tag/mention to another - buttons must be disabled every time since CKEditor itself re-enable buttons when navigating elements in editor
	{
		var preserveButtonState = designEditorRestoreButtonState === null;

		if (preserveButtonState === true)
		{
			designEditorRestoreButtonState = {};
		}

		Fit.Array.ForEach(designEditor.toolbar, function(toolbarGroup)
		{
			var items = toolbarGroup.items;

			Fit.Array.ForEach(toolbarGroup.items, function(item)
			{
				if (item.command) // Buttons have a command identifier which can be used to resolve the actual command instance
				{
					var cmd = designEditor.getCommand(item.command);

					if (preserveButtonState === true && cmd.state !== CKEDITOR.TRISTATE_DISABLED) // https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_command.html#property-state
					{
						designEditorRestoreButtonState[item.command] = true;
					}

					cmd.disable();
				}
				else if (item.setState) // MenuButtons allow for direct manipulation of enabled/disabled state
				{
					if (preserveButtonState === true && item.getState() !== CKEDITOR.TRISTATE_DISABLED) // https://ckeditor.com/docs/ckeditor4/latest/api/CKEDITOR_command.html#property-state
					{
						designEditorRestoreButtonState[item.name] = item;
					}

					item.setState(CKEDITOR.TRISTATE_DISABLED);
				}
			});
		});
	}

	function restoreDesignEditorButtons()
	{
		if (designEditorRestoreButtonState !== null)
		{
			Fit.Array.ForEach(designEditorRestoreButtonState, function(commandKey)
			{
				if (designEditorRestoreButtonState[commandKey] === true) // Command button
				{
					var cmd = designEditor.getCommand(commandKey);
					cmd.enable();
				}
				else // MenuButton
				{
					designEditorRestoreButtonState[commandKey].setState(CKEDITOR.TRISTATE_OFF); // Enabled but not highlighted/activated like e.g. a bold button would be when selecting bold text
				}
			});

			designEditorRestoreButtonState = null;
		}
	};

	function updateDesignEditorSize()
	{
		if (me.DesignMode() === true && designEditorHeightMonitorId === -1)
		{
			// Postpone if editor is not ready yet

			if (designEditorUpdateSizeDebouncer !== -1)
			{
				clearTimeout(designEditorUpdateSizeDebouncer);
				designEditorUpdateSizeDebouncer = -1;
			}

			if (designModeEnabledAndReady() === false)
			{
				// Postpone, editor is not ready yet.
				// This may happen when editor is created and Width(..) is
				// immediately set after creating and mounting the control.
				// https://github.com/Jemt/Fit.UI/issues/34
				// This is a problem because CKEditor uses setTimeout(..) to for instance
				// allow early registration of events, and because resources are loaded
				// in an async. manner.
				designEditorUpdateSizeDebouncer = setTimeout(function() // Timer is stopped if control is disposed
				{
					designEditorUpdateSizeDebouncer = -1;
					updateDesignEditorSize();
				}, 100);

				return;
			}

			// Postpone update to editor size if control is currently hidden or not
			// rooted in DOM, in which case designEditor.resize(..) will throw an error.

			if (mutationObserverId !== -1) // Cancel any mutation observer previously registered
			{
				Fit.Events.RemoveMutationObserver(mutationObserverId);
				mutationObserverId = -1;
			}

			if (Fit.Dom.IsVisible(me.GetDomElement()) === false) // Hidden (e.g. display:none or not rooted in DOM)
			{
				// Mutation observer is triggered when element changes, including when rooted, in which case
				// width and height becomes measurable, and changes to dimensions also trigger mutation observer.
				mutationObserverId = Fit.Events.AddMutationObserver(me.GetDomElement(), function(elm)
				{
					if (Fit.Dom.IsVisible(me.GetDomElement()) === true)
					{
						disconnect();
						mutationObserverId = -1;

						updateDesignEditorSize(); // Does nothing if DesignMode is no longer enabled
					}
				});

				return;
			}

			//var w = me.Width();
			var h = me.Height();

			// If editor is configured with AutoGrow enabled and toolbar is configured with HideWhenInactive,
			// then editor won't be able to adjust its height when not focused, since a fixed height is applied
			// to the editable area while the toolbar is hidden. Therefore, temporarily show the toolbar, update
			// the editor size, and then hide the toolbar again.
			var showHideToolbar = me.Focused() === false;

			// Default control width is 200px (defined in Styles.css).
			// NOTICE: resize does not work reliably when editor is hidden, e.g. behind a tab with display:none.
			// The height set will not have the height of the toolbar substracted since the height can not be
			// determined for hidden objects, so the editor will become larger than the value set (height specified + toolbar height).
			// http://docs.ckeditor.com/#!/api/CKEDITOR.editor-method-resize
			designEditorSuppressOnResize = true;
			showHideToolbar && restoreHiddenToolbarInDesignEditor(true); // Does nothing unless HideWhenInactive is enabled - true argument prevents call back to updateDesignEditorSize again, hence preventing a "maximum call stack exceeded" error
			designEditor.resize("100%", h.Value > -1 ? h.Value + h.Unit : "100%"); // A height of 100% allow editor to automatically adjust the height of the editor's content area to the height of its content (data-autogrow="true" must be set to make control container adjust to its content as well)
			showHideToolbar && hideToolbarInDesignMode(true); // Does nothing unless HideWhenInactive is enabled - true argument prevents call back to updateDesignEditorSize again, hence preventing a "maximum call stack exceeded" error
			designEditorSuppressOnResize = false;
		}
	}

	function enableDesignEditorHeightMonitor(enable)
	{
		Fit.Validation.ExpectBoolean(enable);

		if (enable === true && designEditorHeightMonitorId === -1)
		{
			// Temporary fixed height might be set (see hideToolbarInDesignMode()).
			// Remove it - it will prevent editor from obtaining the height of the control container.
			designEditorDom.Editable.style.height = "";

			var toolbarContainer = designEditorDom.Top || designEditorDom.Bottom; // Top is null if editor is placed at the bottom

			var prevHeight = -1;
			var prevToolbarVisible = toolbarContainer.style.display === "";

			designEditorHeightMonitorId = setInterval(function()
			{
				var newHeight = me.GetDomElement().offsetHeight; // Returns 0 if element is not visible
				var newToolbarVisible = toolbarContainer.style.display === "";

				if (newHeight > 0 && (newHeight !== prevHeight || newToolbarVisible !== prevToolbarVisible))
				{
					prevHeight = newHeight;
					prevToolbarVisible = newToolbarVisible;

					designEditorSuppressOnResize = true;
					designEditor.resize("100%", newHeight + "px"); // Assume full width and height of control container - height:100% does not achieve this, so we apply height in pixels
					designEditorSuppressOnResize = false;
				}
			}, 250);
		}
		else if (enable === false && designEditorHeightMonitorId !== -1)
		{
			clearInterval(designEditorHeightMonitorId);
			designEditorHeightMonitorId = -1;
		}
	}

	function isToolbarHiddenInDesignEditor() // Returns True if editor is fully loaded and toolbar is hidden
	{
		var toolbarContainer = designModeEnabledAndReady() === true ? designEditorDom.Top || designEditorDom.Bottom : null; // Top is null if editor is placed at the bottom
		return (toolbarContainer !== null && toolbarContainer.style.display === "none");
	}

	function hideToolbarInDesignMode(suppressUpdateEditorSize)
	{
		Fit.Validation.ExpectBoolean(suppressUpdateEditorSize, true);

		if (designModeEnabledAndReady() === true && designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.HideWhenInactive === true)
		{
			var toolbarContainer = designEditorDom.Top || designEditorDom.Bottom; // Top is null if editor is placed at the bottom

			if (toolbarContainer.style.display === "none")
			{
				return; // Already hidden
			}

			// Prevent editor from increasing its height when toolbar is shown.
			// This is not ideal. We use the top/bottom's (toolbar's) height but it might change
			// if window is resized, which will cause buttons to "word wrap". But that is
			// acceptable. In this case the editor might change dimensions when toolbar is
			// shown and static height on content area is removed in OnFocus handler registered
			// in init().

			var updateSize = false;

			if (designEditorHeightMonitorId === -1) // Do not apply temporary fixed height if height monitor is running - in this case height will be adjusted as needed
			{
				var content = designEditorDom.Editable;
				content.style.height = toolbarContainer.offsetHeight + content.offsetHeight + "px";

				updateSize = true;
			}

			// Hide toolbar

			toolbarContainer.style.display = "none";

			me._internal.Data("toolbar", "false");

			// Make editable area adjust to take up space previously consumed by toolbar
			updateSize === true && suppressUpdateEditorSize !== true && updateDesignEditorSize();
		}
	}

	function restoreHiddenToolbarInDesignEditor(suppressUpdateEditorSize)
	{
		Fit.Validation.ExpectBoolean(suppressUpdateEditorSize, true);

		if (designModeEnabledAndReady() === true && designEditorConfig !== null && designEditorConfig.Toolbar && designEditorConfig.Toolbar.HideWhenInactive === true)
		{
			// Toolbar has been initially hidden - make it appear again

			var toolbarContainer = designEditorDom.Top || designEditorDom.Bottom; // Top is null if editor is placed at the bottom

			if (toolbarContainer.style.display === "")
			{
				return; // Already restored - no longer hidden
			}

			toolbarContainer.style.display = "";

			// Hiding the toolbar will reduce the height of the editor since the toolbar takes up place when shown.
			// Displaying the toolbar again later will naturally increase the editor's height again. To avoid this,
			// a fixed height is applied to the editable area when toolbar is hidden, so the editor remains the same
			// height. This fixed height is removed once the toolbar is shown again.
			// However, if the editor has been resized, then we need to use the resized height of the editor and reduce
			// the height of the editable area, so the toolbar can fit within the editor without increasing its height.
			// We must keep the size set by the user.

			if (me._internal.Data("resized") === "false")
			{
				// Remove fixed height from editable area. When toolbar is
				// shown again, editor will assume its normal height again.
				var content = designEditorDom.Editable;
				content.style.height = "";
			}
			else
			{
				// User has changed size of editor. Reduce height of editable area so that
				// the toolbar can fit within the editor without increasing the height of it.
				var content = designEditorDom.Editable;
				content.style.height = (content.offsetHeight - toolbarContainer.offsetHeight) + "px";
			}

			me._internal.Data("toolbar", "true");

			if (designEditorHeightMonitorId === -1)
			{
				// Update size of editable area in case auto grow is not enabled, in which case
				// toolbar will now have taken up space outside of control's container (overflowing).
				// Make editable area fit control container again.
				suppressUpdateEditorSize !== true && updateDesignEditorSize();
			}
			else
			{
				// Restart height monitor to force update to editor height.
				// Toolbar buttons caused editor to increase its height so it no longer
				// fits within the control container - the editor exceeds the boundaries.
				enableDesignEditorHeightMonitor(false);
				enableDesignEditorHeightMonitor(true);
			}
		}
	}

	function updateDesignEditorPlaceholder(clearPlaceholder)
	{
		Fit.Validation.ExpectBoolean(clearPlaceholder, true);

		if (designModeEnabledAndReady() === true)
		{
			if (Fit.Browser.GetBrowser() === "MSIE" && Fit.Browser.GetVersion() < 10)
			{
				// Native support for placeholders (using the real placeholder attribute) was
				// introduced in IE10, so we want to ensure consistent behaviour for all controls,
				// as e.g. Input and DatePicker uses the native placeholder implementation.
				return;
			}

			// WARNING: Retrieving value from editor is expensive! Do not
			// call updateDesignEditorPlaceholder() too often (e.g. OnChange).
			// Simply make sure placeholder is updated OnFocus and OnBlur.

			var val = clearPlaceholder !== true && me.Value() === "" ? me.Placeholder() : "";
			Fit.Dom.Data(designEditorDom.Editable, "placeholder", val || null);

			if (val !== "")
			{
				designEditorClearPlaceholder = true;
			}
		}
	}

	function openDetachedDesignEditor()
	{
		me._internal.FocusStateLocked(true);

		// Re-use previously created detached editor

		if (designEditorDetached !== null)
		{
			designEditorDetached.Open();
			return;
		}

		// Create dialog editor and buttons

		var de = new Fit.Controls.DialogEditor();
		var cmdOk = new Fit.Controls.Button();
		var cmdCancel = new Fit.Controls.Button();

		// Configure dialog

		var setSettings = function(preserveCustomSizeAndPosition)
		{
			// Editor configuration

			// Configure detached editor like original, but with a few required changes.
			// We need to make sure image blobs are handled properly, that detached editor
			// cannot created another detached editor, that the toolbar is initially visible
			// at the top of the dialog, and that auto grow is disabled.

			var deConfig = Fit.Core.Clone(designEditorConfig || {});

			if (designModeEnableImagePlugin() === true)
			{
				deConfig = Fit.Core.Merge(deConfig, // Override image plugin configuration
				{
					Plugins:
					{
						Images:
						{
							Enabled: true,
							EmbedType: deConfig.Plugins && deConfig.Plugins.Images && deConfig.Plugins.Images.EmbedType,

							// Image blobs added in detached editor must always be disposed if no longer referenced.
							// Furthermore we make sure image blobs originating from main editor are never disposed.
							// When detached editor is closed, images transfered from detached editor to main editor
							// are added to the main editor's index over image blobs so that the main editor becomes
							// responsible for the memory management of these.
							// If detached editor is closed without transfering changes (canceled), all images found
							// in the detached editor, which are not referenced in the main editor, are disposed.
							// See OnClick handlers for OK and Cancel buttons.

							RevokeBlobUrlsOnDispose: "UnreferencedOnly",	// Make dialog editor preserve newly added (and still referenced) image blobs when disposed
							RevokeExternalBlobUrlsOnDispose: false			// Make dialog editor preserve images blobs initially added from main editor
						}
					}
				});
			}

			deConfig.Toolbar = deConfig.Toolbar || {};
			deConfig.Toolbar.Detach = false;
			deConfig.Toolbar.Position = "Top";
			deConfig.Toolbar.Sticky = false;
			deConfig.Toolbar.HideWhenInactive = false;

			delete deConfig.AutoGrow;

			// Dialog configuration - apply default values for properties not defined

			var detachConfig = deConfig.Detachable || {};
			delete deConfig.Detachable;

			detachConfig = Fit.Core.Merge(detachConfig, // Apply default values - existing properties are preserved (Fit.Core.MergeOverwriteBehaviour.Never)
			{
				Title: "",
				Maximizable: true,
				Maximized: false,
				Draggable: true,
				Resizable: true,
				Width: detachConfig.Width ? detachConfig.Width : { Value: 850, Unit: "px" },
				MinimumWidth: detachConfig.MinimumWidth ? detachConfig.MinimumWidth : { Value: 20, Unit: "em" },
				MaximumWidth: detachConfig.MaximumWidth ? detachConfig.MaximumWidth : { Value: 100, Unit: "%" },
				Height: detachConfig.Height ? detachConfig.Height : { Value: 550, Unit: "px" },
				MinimumHeight: detachConfig.MinimumHeight ? detachConfig.MinimumHeight : { Value: 12, Unit: "em" },
				MaximumHeight: detachConfig.MaximumHeight ? detachConfig.MaximumHeight : { Value: 100, Unit: "%" }
			}, Fit.Core.MergeOverwriteBehaviour.Never);

			// Set dialog settings

			de.Title(detachConfig.Title);
			de.Modal(true);
			de.Draggable(detachConfig.Draggable);
			de.Resizable(detachConfig.Resizable);
			de.Maximizable(detachConfig.Maximizable);
			de.Maximized(detachConfig.Maximized);
			preserveCustomSizeAndPosition === false && de.Width(detachConfig.Width.Value, detachConfig.Width.Unit || "px");
			preserveCustomSizeAndPosition === false && de.Height(detachConfig.Height.Value, detachConfig.Height.Unit || "px");
			de.MinimumWidth(detachConfig.MinimumWidth.Value, detachConfig.MinimumWidth.Unit || "px");
			de.MinimumHeight(detachConfig.MinimumHeight.Value, detachConfig.MinimumHeight.Unit || "px");
			de.MaximumWidth(detachConfig.MaximumWidth.Value, detachConfig.MaximumWidth.Unit || "px");
			de.MaximumHeight(detachConfig.MaximumHeight.Value, detachConfig.MaximumHeight.Unit || "px");

			preserveCustomSizeAndPosition === false && de.Reset(); // Reset custom size (resized) and position (dragged)

			// Set dialog editor settings

			de.CheckSpelling(me.CheckSpelling());
			de._internal.SetDesignModeConfig(deConfig);
		};

		// Localization support

		var localizeDetachedEditor = function()
		{
			// Editor itself is already localized, so we just need to
			// localize the dialog. The locale variable will already have
			// been updated by the OnLocaleChanged handler registered in init().

			cmdOk.Title(locale.Ok);
			cmdCancel.Title(locale.Cancel);
		};
		Fit.Internationalization.OnLocaleChanged(localizeDetachedEditor);

		// Commit changes when pressing CTRL + S (Windows) or CMD + S (Mac)

		Fit.Events.AddHandler(de.GetDomElement(), "keydown", function(e)
		{
			var ev = Fit.Events.GetEvent(e);

			if ((ev.ctrlKey === true || ev.metaKey === true) && ev.keyCode === 83) // CTRL/CMD + S
			{
				cmdOk.Click();
				Fit.Events.PreventDefault(ev);
			}
		});

		// Expose detached editor API

		designEditorDetached =
		{
			IsActive: false,

			GetValue: function()
			{
				return de.Value();
			},

			SetVisible: function(val)
			{
				// Focus state remains locked when toggling visibility.
				// We merely make sure to invoke OnBlur and OnFocus events.
				// Focus lock is only released when detached editor is closed
				// or if control is disposed.

				if (val === false && de.IsOpen() === true)
				{
					de.Close();
					me._internal.FireOnBlur();
				}
				else if (val === true && de.IsOpen() === false)
				{
					de.Open(); // Automatically brings focus to editor
					me._internal.FireOnFocus();
				}
			},

			SetEnabled: function(val)
			{
				if (val === false && de.Enabled() === true)
				{
					de.Enabled(false);
					cmdOk.Enabled(false);
					cmdCancel.Focused(true);
				}
				else if (val === true && de.Enabled() === false)
				{
					de.Enabled(true);
					cmdOk.Enabled(true);
					de.Focused(true);
				}
			},

			Focus: function()
			{
				if (de.Enabled() === true)
				{
					de.Focused(true);
				}
				else
				{
					cmdCancel.Focused(true);
				}
			},

			// GetFocused: function()
			// {
			// 	return de.Focused() === true /* also returns true if e.g. link/image dialog is open */
			// 		|| cmdOk.Focused() === true || cmdCancel.Focused() === true;
			// },

			Reload: function()
			{
				setSettings(true); // True argument = preserve custom size (resized) and position (dragged)
			},

			Open: function()
			{
				designEditorDetached.IsActive = true;
				de.Value(me.Value());
				setSettings(false); // False argument = reset custom size (resized) and position (dragged)
				de.Open();
			},

			Close: function()
			{
				designEditorDetached.IsActive = false;
				de.Close();
			},

			Dispose: function()
			{
				Fit.Internationalization.RemoveOnLocaleChanged(localizeDetachedEditor);
				de.Dispose(); // Will also dispose associated buttons
				designEditorDetached = null;
			}
		};

		cmdOk.Title(locale.Ok);
		cmdOk.Icon("check");
		cmdOk.Type(Fit.Controls.ButtonType.Success);
		cmdOk.OnClick(function(sender)
		{
			var referencedBlobUrls = Fit.String.ParseImageBlobUrls(de.Value());
			Fit.Array.ForEach(referencedBlobUrls, function(blobUrl)
			{
				if (Fit.Array.Contains(imageBlobUrls, blobUrl) === false)
				{
					Fit.Array.Add(imageBlobUrls, blobUrl);
				}
			});

			me.Value(de.Value());

			designEditorDetached.Close();

			me.Focused(true);
			me._internal.FocusStateLocked(false);
		});
		de.AddButton(cmdOk);

		cmdCancel.Title(locale.Cancel);
		cmdCancel.Icon("ban");
		cmdCancel.Type(Fit.Controls.ButtonType.Danger);
		cmdCancel.OnClick(function(sender)
		{
			var closeDialog = function()
			{
				var referencedBlobUrls = Fit.String.ParseImageBlobUrls(de.Value());
				Fit.Array.ForEach(referencedBlobUrls, function(blobUrl)
				{
					if (Fit.Array.Contains(imageBlobUrls, blobUrl) === false) // Only remove images added in dialog editor
					{
						URL.revokeObjectURL(blobUrl);
					}
				});

				var enabled = me.Enabled();
				designEditorDetached.Close(); // Close first so me.Focused(true) below does not redirect focus to detached editor

				if (enabled === true) // Return focus to control if it is still enabled - if not, do not return focus and fire OnBlur
				{
					me.Focused(true);
					me._internal.FocusStateLocked(false);
				}
				else
				{
					me._internal.FocusStateLocked(false);
					me._internal.FireOnBlur();
				}
			};

			if (de.Value() !== me.Value())
			{
				Fit.Controls.Dialog.Confirm(locale.CancelConfirmTitle + "<br><br>" + locale.CancelConfirmDescription, function(res)
				{
					if (res === true)
					{
						closeDialog();
					}
					else
					{
						cmdCancel.Focused(true);
					}
				});
			}
			else
			{
				closeDialog();
			}
		});
		de.AddButton(cmdCancel);

		designEditorDetached.Open();
	}

	function removeCkeSavedSrcAttributesFromDesignEditor() // Editor must be fully initialized when calling this function (designEditorDom is required)
	{
		// Remove data-cke-saved-src attributes from images - they contain a duplicate
		// value of the src attribute which might be very large when pasting base64 images.
		// Investigating the use of data-cke-saved-src (https://github.com/ckeditor/ckeditor4/search?q=cke-saved-src)
		// reveals that the data-cke-saved-src attribute is preferred over the src attribute
		// which makes sense if an image is temporarily replaced by a place holder, e.g. when uploading.
		// But we do not rely on such functionality, so the src attribute alone should be sufficient.
		// Also see related bug report: https://github.com/ckeditor/ckeditor4/issues/5151
		var imageTags = designEditorDom.Editable.querySelectorAll('img[data-cke-saved-src]');
		Fit.Array.ForEach(imageTags, function(img)
		{
			Fit.Dom.Data(img, "cke-saved-src", null);
		});
	}

	function isTable(element)
	{
		Fit.Validation.ExpectElement(element);

		var isTable = false;
		var elm = element;

		while (elm !== me.GetDomElement())
		{
			if (elm.tagName === "TABLE")
			{
				isTable = true;
				break;
			}

			elm = elm.parentElement;
		}

		return isTable;
	}

	function revertToSingleLineIfNecessary()
	{
		if (wasAutoChangedToMultiLineMode === true && me.Maximizable() === false && me.Resizable() === Fit.Controls.InputResizing.Disabled && me.DesignMode() === false)
		{
			me.MultiLine(false); // Changes wasAutoChangedToMultiLineMode to false
		}
	}

	function fireOnChange()
	{
		var newVal = me.Value();
		var compareValue = me.Type() === "Color" ? preVal.toUpperCase() : preVal; // Value() returns uppercase value for color picker - preVal might be in lower case if assigned before input type was changed

		if (newVal !== compareValue)
		{
			// DISABLED: No longer necessary with the introduction of designEditorDirty which ensures
			// that we get the initial value set from Value(), unless changed by the user using the editor.
			/*if (designEditor !== null && htmlWrappedInParagraph === false) // A value not wrapped in paragraph(s) was assigned to HTML editor
			{
				// Do not trigger OnChange if the only difference is that CKEditor
				// wrapped the value initially assigned to control in a paragraph.
				// Only changes made programmatically through the Input control's API
				// or by the user should be pushed.
				// This approach is not perfect unfortunately. For instance CKEditor
				// trims the value, so assigning " hello world" or " <p>Hello world</p>"
				// to the control will result in OnChange firing if fireOnChange() is called.

				var newValWithoutParagraph = newVal.replace(/^<p>/, "").replace(/<\/p>$/, ""); // Remove <p> and </p> at the beginning and end

				if (newValWithoutParagraph === preVal)
				{
					return; // Do not fire OnChange
				}
			}*/

			preVal = newVal;
			me._internal.FireOnChange();
		}
	}

	function reloadEditor(force, reloadConfig)
	{
		Fit.Validation.ExpectBoolean(force, true);
		Fit.Validation.ExpectObject(reloadConfig, true); // Not validated further, as it has already been validated in DesignMode(..)

		if (force !== true && (designModeEnabledAndReady() === false || designEditorMustReloadWhenReady === true))
		{
			// Attempting to reload editor while initializing - postpone until editor is fully loaded,
			// since we cannot guarantee reliable behavior with CKEditor if it's disposed while loading.
			designEditorMustReloadWhenReady = true;
			designEditorReloadConfig = reloadConfig || designEditorReloadConfig;
			return;
		}

		designEditorMustReloadWhenReady = false;

		// Disabling DesignMode brings it back to input or textarea mode.
		// If reverting to input mode, Height is reset, so we need to preserve that.

		// NOTICE: Custom width/height set using resize handle is not preserved when editor is reloaded

		var height = me.Height();
		var currentWasAutoChangedToMultiLineMode = wasAutoChangedToMultiLineMode; // DesignMode(false) will result in wasAutoChangedToMultiLineMode being set to false if DesignMode(true) changed the control to MultiLine mode

		// Prevent detached editor from being closed when reloading, e.g. if CheckSpelling is changed.
		// Editor will also be reloaded if a different editor configuration is passed to DesignMode(true, updatedConfig).
		var detachedEditor = null;
		if (designEditorDetached !== null)
		{
			detachedEditor = designEditorDetached;
			designEditorDetached = null; // Prevent me.DesignMode(false), which in turn calls destroyDesignEditorInstance(), from closing detached editor dialog
		}

		me.DesignMode(false);
		me.DesignMode(true, reloadConfig || designEditorReloadConfig || undefined); // Use reloadConfig if set (and if reload was not postponed) or use designEditorReloadConfig if reload was postponed with updated editor config
		designEditorReloadConfig = null;

		if (detachedEditor !== null)
		{
			designEditorDetached = detachedEditor;
			designEditorDetached.Reload(); // Reload detached editor to reflect any changes made to configuration
		}

		me.Height(height.Value, height.Unit);
		wasAutoChangedToMultiLineMode = currentWasAutoChangedToMultiLineMode;
	}

	function destroyDesignEditorInstance()
	{
		// Destroying editor also fires OnHide event for any dialog currently open, which will clean up:
		// Fit._internal.Controls.Input.ActiveEditorForDialog;
		// Fit._internal.Controls.Input.ActiveEditorForDialogDestroyed;
		// Fit._internal.Controls.Input.ActiveEditorForDialogDisabledPostponed;
		// Fit._internal.Controls.Input.ActiveDialogForEditor;
		// Fit._internal.Controls.Input.ActiveDialogForEditorCanceled;

		// Calling destroy() fires OnHide for any dialog currently open, which
		// in turn disables locked focus state and returns focus to the control.

		designEditor.destroy();

		if (designEditorDetached !== null)
		{
			designEditorDetached.Dispose();
		}

		if (designEditorGlobalKeyDownEventId !== -1)
		{
			Fit.Events.RemoveHandler(document, designEditorGlobalKeyDownEventId);
		}

		if (designEditorGlobalKeyUpEventId !== -1)
		{
			Fit.Events.RemoveHandler(document, designEditorGlobalKeyUpEventId);
		}

		designEditor = null;
		designEditorDom = null;
		//designEditorDirty = false; // Do NOT reset this! We need to preserve dirty state in case DesignMode is reloaded!
		designEditorDirtyPending = false;
		//designEditorConfig = null; // Do NOT nullify this! We need it, in case DesignMode is toggled!
		//designEditorReloadConfig = null; // Do NOT nullify this! We need it, in case DesignMode is reloaded!
		designEditorRestoreButtonState = null;
		designEditorSuppressPaste = false;
		designEditorSuppressOnResize = false;
		designEditorMustReloadWhenReady = false;
		designEditorMustDisposeWhenReady = false;
		designEditorActiveToolbarPanel = null;
		designEditorDetached = null;
		designEditorClearPlaceholder = true;
		designEditorCleanEditableDom = false;
		designEditorGlobalKeyDownEventId = -1;
		designEditorGlobalKeyUpEventId = -1;

		if (designEditorUpdateSizeDebouncer !== -1)
		{
			clearTimeout(designEditorUpdateSizeDebouncer);
			designEditorUpdateSizeDebouncer = -1;
		}

		if (designEditorHeightMonitorId !== -1)
		{
			clearInterval(designEditorHeightMonitorId);
			designEditorHeightMonitorId = -1;
		}

		if (mutationObserverId !== -1)
		{
			Fit.Events.RemoveMutationObserver(mutationObserverId);
			mutationObserverId = -1;
		}

		if (rootedEventId !== -1)
		{
			Fit.Events.RemoveHandler(me.GetDomElement(), rootedEventId);
			rootedEventId = -1;
		}

		if (createWhenReadyIntervalId !== -1)
		{
			clearInterval(createWhenReadyIntervalId);
			createWhenReadyIntervalId = -1;
		}
	}

	function designModeEnabledAndReady()
	{
		return designEditorDom !== null; // Editor is fully loaded when editor DOM is made available
	}

	function designModeEnableImagePlugin()
	{
		var config = designEditorConfig || {};
		var enableImagePlugin = (config.Plugins && config.Plugins.Images && config.Plugins.Images.Enabled === true) || (config.Toolbar && config.Toolbar.Images === true) || false;

		// Force enable image support if images are contained in value - otherwise editor will remove them
		if (enableImagePlugin === false && designEditorDetached !== null && designEditorDetached.GetValue().indexOf("<img ") > -1)
		{
			enableImagePlugin = true;
		}
		if (enableImagePlugin === false && me.Value().indexOf("<img ") > -1)
		{
			enableImagePlugin = true;
		}

		return enableImagePlugin;
	}

	function localize()
	{
		locale = Fit.Internationalization.GetLocale(me);

		if (me.DesignMode() === true)
		{
			// Prevent reloadEditor() from reloading detached editor.
			// It will automatically reload when locale is changed.
			// Without this guard the editor would reload twice.
			var detachedEditor = null;
			if (designEditorDetached !== null)
			{
				detachedEditor = designEditorDetached;
				designEditorDetached = null; // Prevent reloadEditor() from reloading detached editor
			}

			// Re-create editor with new language
			reloadEditor();

			if (detachedEditor !== null)
			{
				designEditorDetached = detachedEditor;
			}
		}
	}

	function repaint()
	{
		if (isIe8 === true)
		{
			me.AddCssClass("FitUi_Non_Existing_Input_Class");
			me.RemoveCssClass("FitUi_Non_Existing_Input_Class");
		}
	}

	init();
}

/// <container name="Fit.Controls.InputType">
/// 	Enum values determining input type
/// </container>
Fit.Controls.InputType =
{
	/// <member container="Fit.Controls.InputType" name="Textarea" access="public" static="true" type="string" default="Textarea">
	/// 	<description> Multi line input field </description>
	/// </member>
	Textarea: "Textarea",

	/// <member container="Fit.Controls.InputType" name="Color" access="public" static="true" type="string" default="Color">
	/// 	<description> Input control useful for entering a color </description>
	/// </member>
	Color: "Color",

	/// <member container="Fit.Controls.InputType" name="Date" access="public" static="true" type="string" default="Date">
	/// 	<description> Input control useful for entering a date </description>
	/// </member>
	Date: "Date",

	/// <member container="Fit.Controls.InputType" name="DateTime" access="public" static="true" type="string" default="DateTime">
	/// 	<description> Input control useful for entering a date and time </description>
	/// </member>
	DateTime: "DateTime",

	/// <member container="Fit.Controls.InputType" name="Email" access="public" static="true" type="string" default="Email">
	/// 	<description> Input control useful for entering an e-mail address </description>
	/// </member>
	Email: "Email",

	/// <member container="Fit.Controls.InputType" name="Month" access="public" static="true" type="string" default="Month">
	/// 	<description> Input control useful for entering a month </description>
	/// </member>
	Month: "Month",

	/// <member container="Fit.Controls.InputType" name="Number" access="public" static="true" type="string" default="Number">
	/// 	<description> Input control useful for entering a number </description>
	/// </member>
	Number: "Number",

	/// <member container="Fit.Controls.InputType" name="Password" access="public" static="true" type="string" default="Password">
	/// 	<description> Input control useful for entering a password (characters are masked) </description>
	/// </member>
	Password: "Password",

	/// <member container="Fit.Controls.InputType" name="PhoneNumber" access="public" static="true" type="string" default="PhoneNumber">
	/// 	<description> Input control useful for entering a phone number </description>
	/// </member>
	PhoneNumber: "PhoneNumber",

	/// <member container="Fit.Controls.InputType" name="Text" access="public" static="true" type="string" default="Text">
	/// 	<description> Input control useful for entering ordinary text </description>
	/// </member>
	Text: "Text",

	/// <member container="Fit.Controls.InputType" name="Time" access="public" static="true" type="string" default="Time">
	/// 	<description> Input control useful for entering time </description>
	/// </member>
	Time: "Time",

	/// <member container="Fit.Controls.InputType" name="Week" access="public" static="true" type="string" default="Week">
	/// 	<description> Input control useful for entering a week number </description>
	/// </member>
	Week: "Week",

	Unknown: "Unknown"
}

Fit.Controls.Input.Type = Fit.Controls.InputType; // Backward compatibility

/// <container name="Fit._internal.Controls.Input">
/// 	Allows for manipulating control (appearance, features, and behaviour).
/// 	Features are NOT guaranteed to be backward compatible, and incorrect use might break control!
/// </container>
Fit._internal.Controls.Input = {};

/// <container name="Fit._internal.Controls.Input.Editor">
/// 	Internal settings related to HTML Editor (Design Mode)
/// </container>
Fit._internal.Controls.Input.Editor =
{
	/// <member container="Fit._internal.Controls.Input.Editor" name="Skin" access="public" static="true" type="'bootstrapck' | 'moono-lisa' | null">
	/// 	<description> Skin used with DesignMode - must be set before an editor is created and cannot be changed for each individual control </description>
	/// </member>
	Skin: null // Notice: CKEditor does not support multiple different skins on the same page - do not change value once an editor has been created
};

/// <container name="Fit.Controls.InputResizing">
/// 	<description> Resizing options </description>
/// 	<member name="Enabled" access="public" static="true" type="string" default="Enabled"> Allow for resizing both vertically and horizontally </member>
/// 	<member name="Disabled" access="public" static="true" type="string" default="Disabled"> Do not allow resizing </member>
/// 	<member name="Horizontal" access="public" static="true" type="string" default="Horizontal"> Allow for horizontal resizing </member>
/// 	<member name="Vertical" access="public" static="true" type="string" default="Vertical"> Allow for vertical resizing </member>
/// </container>
Fit.Controls.InputResizing = // Enums must exist runtime
{
	Enabled: "Enabled",
	Disabled: "Disabled",
	Horizontal: "Horizontal",
	Vertical: "Vertical"
};