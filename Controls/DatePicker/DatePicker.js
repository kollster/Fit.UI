/// <container name="Fit.Controls.DatePicker" extends="Fit.Controls.ControlBase">
/// 	DatePicker control allowing user to easily pick a date and optionally time.
/// 	On mobile devices (phones and tablets) the native date and time pickers are used.
/// 	Extending from Fit.Controls.ControlBase.
/// </container>

/// <function container="Fit.Controls.DatePicker" name="DatePicker" access="public">
/// 	<description> Create instance of DatePicker control </description>
/// 	<param name="ctlId" type="string" default="undefined"> Unique control ID that can be used to access control using Fit.Controls.Find(..) </param>
/// </function>
Fit.Controls.DatePicker = function(ctlId)
{
	Fit.Validation.ExpectStringValue(ctlId, true);
	Fit.Core.Extend(this, Fit.Controls.ControlBase).Apply(ctlId);

	var me = this;
	var input = null;			// Input field for date
	var inputTime = null;		// Input field for time (Null if not enabled)
	var orgVal = null;			// Date object containing control value set using Value(..) or Date(..) - used to determine Dirty state (holds both date and time portion)
	var preVal = "";			// Previous valid date value as string (without time portion)
	var prevTimeVal = "";		// Previous valid time value as string (without date portion)
	var locale = "en";			// Default ("", "en", and "en-US" is the same) - see this.regional[""] decleration in jquery-ui.js
	var localeEnforced = false;	// Whether locale was set by external code which takes precedence over locale set using Fit.Internationalization.Locale(..)
	var format = "MM/DD/YYYY";	// Default format for "en" locale (specified using Fit.UI format - jQuery UI DataPicker uses "mm/dd/yy" - see this.regional[""] decleration in jquery-ui.js)
	var formatEnforced = false;	// Whether format was set by external code which takes precedence over locale set using DatePicker.Locale(..) and Fit.Internationalization.Locale(..)
	var placeholderDate = null;	// Placeholder value for date
	var placeholderTime = null;	// Placeholder value for time
	var weeks = false;			// Whether to display week numbers or not
	var jquery = undefined;		// jQuery instance
	var datepicker = null;		// jQuery UI calendar widget
	var startDate = null;		// Which year/month to display in calendar widget if view needs to be restored (related to restoreView variable)
	var open = false;			// Whether calendar widget is currently open
	var focused = false;		// Whether control is currently focused
	var restoreView = false;	// Whether to keep calendar widget on given year/month when temporarily closing and opening it again
	var updateCalConf = true;	// Whether to set/update calendar widget settings - true on initial load
	var detectBoundaries = false;				// Flag indicating whether calendar widget should detect viewport collision and open upwards when needed
	var detectBoundariesRelToViewPort = false;	// Flag indicating whether calendar widget should be positioned relative to viewport (true) or scroll parent (false)

	//var isMobile = Fit.Browser.GetInfo().IsMobile || (Fit.Browser.GetInfo().IsTouchEnabled && Fit.Browser.GetInfo().Name === "Safari"); // More recent versions of Safari on iPad identifies as a Mac computer by default ("Request desktop website" is enabled by default)
	var isMobile = Fit.Device.OptimizeForTouch;
	var inputMobile = null;		// Native date picker on mobile devices - value selected is synchronized to input field defined above (remains Null on desktop devices)
	var inputTimeMobile = null;	// Native time picker on mobile devices - value selected is synchronized to inputTime field defined above (remains Null on desktop devices)

	// ============================================
	// Init
	// ============================================

	function init()
	{
		input = document.createElement("input");
		input.type = "text";
		input.autocomplete = "off";
		input.spellcheck = false;
		input.placeholder = getDatePlaceholder();
		input.tabIndex = ((isMobile === true) ? -1 : 0);

		input.onkeydown = function(e)
		{
			// Open calendar when arrow down key is pressed

			var ev = Fit.Events.GetEvent(e);

			if (ev.keyCode === 40) // Arrow down
			{
				me.Show();
			}
		}

		input.onkeyup = function()
		{
			// Fire OnChange when a valid value is entered

			var curDateTime = me.Date();

			if (input.value !== "" && curDateTime === null)
				return; // Invalid value

			var curDateStr = ((curDateTime !== null) ? Fit.Date.Format(curDateTime, me.Format()) : ""); // Not using Value() which includes time if enabled

			if (curDateStr !== preVal)
			{
				if (input.value === "" && open === true) // Value cleared while calendar widget is open
				{
					// Fix: DatePicker keeps selection when value is
					// cleared - hide and show again to update picker
					restoreView = true;
					me.Hide();
					me.Show();
					restoreView = false;
				}

				preVal = curDateStr;
				me._internal.FireOnChange();
			}
		}

		input.onchange = function() // OnKeyUp does not catch changes made using mouse (e.g. cut)
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

		input.onpaste = function()
		{
			setTimeout(function() // Postpone - OnPaste fires before pasted value is set
			{
				input.onkeyup();

				// The calendar widget is not updated when pasting a value
				// using the context menu. CTRL/CMD + V updates it just fine though.
				// Force it to always update when pasting a value.
				if (open === true)
				{
					me.Hide();
					me.Show();
				}

				startDate = null;
			}, 0);
		}

		input.onclick = function()
		{
			me.Show();
		}

		// Prevent OnFocus from firing when user interacts with calendar widget which
		// is not contained in div.FitUiControlDatePicker (changing month/year and selecting date).
		// Focus is returned to input almost immediately after interacting with calendar widget.
		//  - Also see FireOnBlur override further down.
		me._internal.FireOnFocus = Fit.Core.CreateOverride(me._internal.FireOnFocus, function()
		{
			if (focused === false)
			{
				focused = true;
				base();
			}
		});

		// Prevent OnBlur from firing when user interacts with calendar widget which
		// is not contained in div.FitUiControlDatePicker (changing month/year).
		// Focus is returned to input almost immediately after interacting with calendar widget.
		//  - Also see FireOnFocus override above.
		me._internal.FireOnBlur = Fit.Core.CreateOverride(me._internal.FireOnBlur, function()
		{
			var pointerState = Fit.Events.GetPointerState();
			var userAction = pointerState.Buttons.Primary === true || pointerState.Buttons.Touch === true;

			if (open === true && userAction === true) // Skipping invocation of OnBlur event when user interacts with calendar widget
			{
				return;
			}

			focused = false;
			base();
		});

		input.onblur = function()
		{
			if (me === null)
			{
				// Fix for Chrome which fires OnChange and OnBlur (in both capturering and bubbling phase)
				// if control has focus while being removed from DOM, e.g. if used in a dialog closed using ESC.
				// More details here: https://bugs.chromium.org/p/chromium/issues/detail?id=866242
				return;
			}

			// Make sure date entered is properly formatted (e.g. 1-1-2012 transforms to 01-01-2012)

			if (open === true)
				return; // Do not execute code below when input looses focus when user interacts with calendar widget

			// The input.onchange/onpaste/onkeyup events constantly updates preVal,
			// so it always contains the last valid (and properly formatted) value.

			// Notice that the calendar widget is temporarily closed when clearing the
			// control value using e.g. CTRL+X or CMD+X. This causes OnBlur to fire and
			// reach the code below BEFORE preVal is updated, because this value is not
			// updated until Key UP. This results in the previous value being restored
			// every time the user tries to clear the input field. The fix is a simple
			// as making sure preVal is only used when the input field actually contains
			// a value.

			if (input.value !== "")
				input.value = preVal;
		}

		me.OnBlur(function(sender)
		{
			if (input.value === "" && inputTime !== null)
			{
				inputTime.value = "";
				prevTimeVal = "00:00";
			}

			if (input.value !== "" && inputTime !== null && inputTime.value === "")
			{
				inputTime.value = "00:00";
				prevTimeVal = "00:00";
			}

			if (open === true) // Calendar might be left open if focus is "stolen" from control, e.g. using document.activeElement.blur(), or using datePicker.Focused(false)
			{
				me.Hide();
			}
		});

		me._internal.AddDomElement(input);
		me.AddCssClass("FitUiControlDatePicker");

		me._internal.Data("weeks", "false");
		me._internal.Data("time", "false");

		if (isMobile === true)
		{
			inputMobile = document.createElement("input");
			inputMobile.type = "date";
			inputMobile.onchange = function()
			{
				if (inputMobile.valueAsDate !== null)
					input.value = Fit.Date.Format(inputMobile.valueAsDate, me.Format());
				else
					input.value = "";

				input.onchange();
			}

			if (Fit.Device.HasMouse === true)
			{
				// This might be an iPad with a pen (precision pointer) attached, or a PC/laptop with a touch screen
				// attached, where touch is considered the primary input method and mouse/pen the secondary input method.

				// Using OnMouseDown event below since OnClick on iOS/Safari 15.6.1 prevents native calendar
				// widget from showing, and OnMouseUp sometimes causes calendar widget to stop emerging on screen.
				// Both mouse and touch events fire, even on pure touch devices.
				inputMobile.onmousedown = function(e)
				{
					// NOTICE: On traditional desktop browsers Show() only works if the native
					// showPicker() function is supported: https://github.com/Jemt/Fit.UI/issues/169
					me.Show();
				}
			}

			me._internal.AddDomElement(inputMobile);
		}

		Fit.Internationalization.OnLocaleChanged(localize);
		localize();
	}

	// ============================================
	// Public - overrides
	// ============================================

	// See documentation on ControlBase
	this.Focused = function(focus)
	{
		Fit.Validation.ExpectBoolean(focus, true);

		if (Fit.Validation.IsSet(focus) === true)
		{
			if (focus === true && me.Focused() === false)
			{
				((inputMobile === null) ? input : inputMobile).focus();
			}
			else if (focus === false && me.Focused() === true)
			{
				Fit.Dom.GetFocused().blur();
			}
		}

		var hasFocus = Fit.Array.Contains([input, inputTime, inputMobile, inputTimeMobile], Fit.Dom.GetFocused()) === true;

		if (hasFocus === false && isMobile === false)
		{
			// Make sure Focused() returns true while interacting with calendar widget - https://github.com/Jemt/Fit.UI/issues/194
			var calendarWidget = document.getElementById("fitui-datepicker-div"); // Null if not loaded yet
			hasFocus = calendarWidget !== null && calendarWidget.style.display === "block" && calendarWidget._associatedFitUiControl === me.GetId();
		}

		return hasFocus;
	}

	/// <function container="Fit.Controls.DatePicker" name="Value" access="public" returns="string">
	/// 	<description>
	/// 		Get/set control value in the following format: YYYY-MM-DD[ hh:mm]
	/// 	</description>
	/// 	<param name="val" type="string" default="undefined"> If defined, value is inserted into control </param>
	/// 	<param name="preserveDirtyState" type="boolean" default="false">
	/// 		If defined, True prevents dirty state from being reset, False (default) resets the dirty state.
	/// 		If dirty state is reset (default), the control value will be compared against the value passed,
	/// 		to determine whether it has been changed by the user or not, when IsDirty() is called.
	/// 	</param>
	/// </function>
	this.Value = function(val, preserveDirtyState) // ONLY accepts YYYY-MM-DD[ hh:mm]
	{
		Fit.Validation.ExpectString(val, true);
		Fit.Validation.ExpectBoolean(preserveDirtyState, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			var fireOnChange = (me.Value() !== val);
			var wasOpen = open;

			if (wasOpen === true)
			{
				restoreView = true;
				me.Hide();
			}

			if (val !== "")
			{
				if (val.indexOf(":") === -1)
					val += " 00:00";

				var date = Fit.Date.Parse(val, "YYYY-MM-DD hh:mm");
				date.setSeconds(0);
				date.setMilliseconds(0);

				input.value = Fit.Date.Format(date, me.Format());
				preVal = input.value;

				if (preserveDirtyState !== true)
				{
					orgVal = date;
				}

				if (inputTime !== null)
				{
					inputTime.value = Fit.Date.Format(date, "hh:mm");
					prevTimeVal = inputTime.value;
				}

				if (inputMobile !== null)
					inputMobile.valueAsDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));

				if (inputTimeMobile !== null)
					inputTimeMobile.value = inputTime.value;
			}
			else
			{
				input.value = "";
				preVal = "";

				if (preserveDirtyState !== true)
				{
					orgVal = null;
				}

				if (inputTime !== null)
				{
					inputTime.value = "";
					prevTimeVal = "00:00";
				}

				if (inputMobile !== null)
					inputMobile.valueAsDate = null;

				if (inputTimeMobile !== null)
					inputTimeMobile.value = "";
			}

			if (wasOpen === true)
			{
				me.Show();
				restoreView = false;
			}

			if (fireOnChange === true)
				me._internal.FireOnChange();
		}

		if (input.value === "")
			return "";

		try
		{
			var value = input.value + ((inputTime !== null) ? " " + ((inputTime.value !== "") ? inputTime.value : "00:00") : "");
			var dtFormat = me.Format() + ((value.indexOf(":") > -1) ? " hh:mm" : "");

			var d = Fit.Date.Parse(value, dtFormat); // May throw exception if value is invalid - this may happen if user is currently entering an invalid value while Value() is being called at the same time async.
			return Fit.Date.Format(d, "YYYY-MM-DD" + ((value.indexOf(":") > -1) ? " hh:mm" : ""));
		}
		catch (err)
		{
		}

		return "";
	}

	/// <function container="Fit.Controls.DatePicker" name="UserValue" access="public" returns="string">
	/// 	<description>
	/// 		Get/set value as if it was changed by the user.
	/// 		Contrary to Value(..), this function allows for a partial (or invalid) date value.
	/// 		If the time picker is enabled (see Time(..)) then both the date and time portion can
	/// 		be set, separated by a space (e.g. 2020-10-25 14:30).
	/// 		OnChange fires if value provided is valid. See ControlBase.UserValue(..) for more details.
	/// 	</description>
	/// 	<param name="val" type="string" default="undefined"> If defined, value is inserted into control </param>
	/// </function>
	this.UserValue = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			// Current state

			var curDate = input.value;
			var curTime = (inputTime !== null ? inputTime.value : null);
			var onChangeFired = false;

			// Parse date and time value

			var datePortion = val;
			var timePortion = null;

			if (inputTime !== null && val.indexOf(" ") !== -1)
			{
				datePortion = val.substring(0, val.indexOf(" "));
				timePortion = val.substring(val.indexOf(" ") + 1);
			}

			if (val === "" && inputTime !== null)
			{
				timePortion = "";
			}

			// Update input fields and fire OnChange

			input.value = datePortion;

			if (inputTime !== null)
			{
				inputTime.value = (timePortion !== null ? timePortion : "");

				if (curTime !== inputTime.value)
				{
					inputTime.onchange(); // Does not fire DatePicker's OnChange if datatime value is invalid, or if value is identical to previously valid value assigned
					onChangeFired = true;
				}
			}

			if (onChangeFired === false && curDate !== input.value)
			{
				input.onchange(); // Does not fire DatePicker's OnChange if date value is invalid, or if value is identical to previously valid value assigned
			}
		}

		return input.value + (inputTime !== null && inputTime.value !== "" ? " " + inputTime.value : "");
	}

	// See documentation on ControlBase
	this.IsDirty = function()
	{
		if (inputTime !== null)
		{
			return (Fit.Core.IsEqual(orgVal, me.Date()) === false);
		}
		else
		{
			var curDate = me.Date();

			if ((orgVal === null && curDate !== null) || (orgVal !== null && curDate === null))
				return true;
			else if (orgVal === null && curDate === null)
				return false;
			else
				return (Fit.Date.Format(orgVal, "YYYY-MM-DD") !== Fit.Date.Format(me.Date(), "YYYY-MM-DD"));
		}
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

		if (datepicker !== null)
		{
			me.Hide();
			datepicker.datepicker("destroy");
		}

		Fit.Internationalization.RemoveOnLocaleChanged(localize);

		me = input = inputTime = orgVal = preVal = prevTimeVal = locale = localeEnforced = format = formatEnforced = placeholderDate = placeholderTime = weeks = jquery = datepicker = startDate = open = focused = restoreView = updateCalConf = detectBoundaries = detectBoundariesRelToViewPort = isMobile = inputMobile = inputTimeMobile = null;
		base();
	});

	// ============================================
	// Public
	// ============================================

	/// <function container="Fit.Controls.DatePicker" name="Date" access="public" returns="Date | null">
	/// 	<description>
	/// 		Get/set control value.
	/// 		The function works the same as the Value function, expect it
	/// 		accepts and returns a Date object instead of a string.
	/// 	</description>
	/// 	<param name="val" type="Date | null" default="undefined"> If defined, date is selected </param>
	/// </function>
	this.Date = function(val)
	{
		Fit.Validation.ExpectDate(val, true);

		// Set value if supplied

		if (val !== undefined) // Allow Null
		{
			if (val !== null)
				me.Value(val.getFullYear() + "-" + (val.getMonth() + 1) + "-" + val.getDate() + " " + val.getHours() + ":" + val.getMinutes());
			else
				me.Clear();
		}

		// Get current value

		var value = me.Value();
		var date = null;

		if (value !== "")
		{
			try
			{
				date = Fit.Date.Parse(value, "YYYY-MM-DD" + ((inputTime !== null) ? " hh:mm" : ""));
			}
			catch (err)
			{
			}
		}

		if (date !== null)
		{
			if (inputTime === null)
			{
				date.setHours(0);
				date.setMinutes(0);
			}

			date.setSeconds(0);
			date.setMilliseconds(0);
		}

		return date;
	}

	/// <function container="Fit.Controls.DatePicker" name="GetText" access="public" returns="string">
	/// 	<description>
	/// 		Get control value as a string. Opposite to the Value function GetText returns the
	/// 		selected Date/DateTime in the format configured (see Format function). The Value
	/// 		function always returns the value in a fixed format, which is YYYY-MM-DD[ hh:mm].
	/// 		The time portion is only appended if time is enabled (see Time function).
	/// 	</description>
	/// </function>
	this.GetText = function()
	{
		var date = me.Date();
		return ((date !== null) ? Fit.Date.Format(date, me.Format() + ((inputTime !== null) ? " hh:mm" : "")) : "");
	}

	/// <function container="Fit.Controls.DatePicker" name="Locale" access="public" returns="string">
	/// 	<description>
	/// 		Get/set locale used by the DatePicker control. This will affect the
	/// 		date format, unless format has been set explicitely, as well as the language used by the calendar widget.
	/// 		DatePicker locale takes precedence over locale set using Fit.Internationalization.Locale(..).
	/// 		Call the GetLocales function to get a complete list of supported locales.
	/// 	</description>
	/// 	<param name="val" type="string" default="undefined"> If defined, locale is changed </param>
	/// </function>
	this.Locale = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			localeEnforced = true;
			setLocale(val);
		}

		return locale;
	}

	/// <function container="Fit.Controls.DatePicker" name="Format" access="public" returns="string">
	/// 	<description>
	/// 		Get/set format used by the DatePicker control. This will affect the format
	/// 		in which the date is presented, as well as the value returned by the GetText function.
	/// 		Format takes precedence over locale.
	/// 	</description>
	/// 	<param name="val" type="string" default="undefined">
	/// 		If defined, format is changed.
	///			The following tokens can be used to construct the format:
	///			YYYY = Year with four digits (e.g. 2016)
	///			M = Month with one digit if possible (e.g. 1 or 12)
	///			MM = Month with two digits (e.g. 01 or 12)
	///			D = Day with one digit if possible (e.g. 1 or 24)
	///			DD = Day with two digits (e.g. 01 or 24)
	/// 		Examples: YYYY-MM-DD or D/M-YYYY
	/// 	</param>
	/// </function>
	this.Format = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			formatEnforced = true;
			setFormat(val);
		}

		return format;
	}

	/// <function container="Fit.Controls.DatePicker" name="DatePlaceholder" access="public" returns="string | null">
	/// 	<description> Get/set date placeholder value. Returns Null if not set. </description>
	/// 	<param name="val" type="string | null" default="undefined">
	/// 		If defined, placeholder is updated. Pass Null to use default
	/// 		placeholder, or an empty string to remove placeholder.
	/// 	</param>
	/// </function>
	this.DatePlaceholder = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (val !== undefined) // Allow Null
		{
			placeholderDate = val;
			input.placeholder = getDatePlaceholder();
		}

		return placeholderDate;
	}

	/// <function container="Fit.Controls.DatePicker" name="TimePlaceholder" access="public" returns="string | null">
	/// 	<description> Get/set time placeholder value. Returns Null if not set. </description>
	/// 	<param name="val" type="string | null" default="undefined">
	/// 		If defined, placeholder is updated. Pass Null to use default
	/// 		placeholder, or an empty string to remove placeholder.
	/// 	</param>
	/// </function>
	this.TimePlaceholder = function(val)
	{
		Fit.Validation.ExpectString(val, true);

		if (val !== undefined) // Allow Null
		{
			placeholderTime = val;

			if (inputTime !== null)
				inputTime.placeholder = getTimePlaceholder();
		}

		return placeholderTime;
	}

	this.WeekNumbers = function(val) // Not supported on mobile, and jQuery calendar is buggy: https://bugs.jqueryui.com/ticket/14907
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			var wasOpen = open;

			if (wasOpen === true)
			{
				restoreView = true;
				me.Hide();
			}

			weeks = val;
			updateCalConf = true; // Update calendar widget settings

			if (wasOpen === true)
			{
				me.Show();
				restoreView = false;
			}

			me._internal.Data("weeks", val.toString());
		}

		return weeks;
	}

	/// <function container="Fit.Controls.DatePicker" name="Time" access="public" returns="boolean">
	/// 	<description>
	/// 		Get/set value indicating whether DatePicker should allow a time portion to be set.
	/// 	</description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, time is changed </param>
	/// </function>
	this.Time = function(val)
	{
		Fit.Validation.ExpectBoolean(val, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			if (val === true && inputTime === null)
			{
				prevTimeVal = "00:00";

				inputTime = document.createElement("input");
				inputTime.type = "text";
				inputTime.autocomplete = "off";
				inputTime.spellcheck = false;
				inputTime.placeholder = getTimePlaceholder();
				inputTime.value = ((me.Date() !== null) ? "00:00" : "");
				inputTime.tabIndex = ((isMobile === true) ? -1 : 0);

				if (me.Date() !== null && orgVal !== null) // DatePicker has a date selected, and had a DateTime value assigned programmatically when created
				{
					inputTime.value = Fit.Date.Format(orgVal, "hh:mm");
					prevTimeVal = inputTime.value;
				}

				inputTime.onkeydown = function(e)
				{
					// Suppress invalid characters

					var ev = Fit.Events.GetEvent(e);
					var mod = Fit.Events.GetModifierKeys();

					// Allow Tab/Backspace/ArrowLeft/ArrowRightDelete/Ctrl/Cmd

					if (ev.keyCode === 9 || ev.keyCode === 8 || ev.keyCode === 37 || ev.keyCode === 39 || ev.keyCode === 46 || mod.Ctrl === true || mod.Meta === true)
						return;

					// Allow colon and 0-9

					var tv = inputTime.value;
					var isColon = (ev.keyCode === 186 || (mod.Shift === true && ev.keyCode === 190)); // Colon (keycode 186 or Shift+190 - depends on browser)
					var valid = (/*tv.length < 5 &&*/ (isColon === true || (ev.keyCode >= 48 && ev.keyCode <= 58) || (ev.keyCode >= 96 && ev.keyCode <= 105))); // Colon or 0-9 (numrow or numpad) - disabled check on length which prevents value from being overwritten when selected

					if (isColon === true && (tv.length === 0 || tv.substring(tv.length - 1) === ":"))
					{
						valid = false; // Skip colon if it is already present - DatePicker adds it automatically which many users overlook
					}

					if (valid === false)
					{
						Fit.Events.PreventDefault(ev);
						return;
					}
				}

				inputTime.onkeyup = function(e)
				{
					// Automatically add colon when hours have been entered

					if (e !== null) // Null when called from inputTime.onchange handler
					{
						var ev = Fit.Events.GetEvent(e);

						if (inputTime.value.length === 2 && inputTime.value.substring(1) !== ":" && ev.keyCode !== 8 && ev.keyCode !== 46) // KeyCodes: Backspace and Delete
						{
							inputTime.value += ":";
							return;
						}
					}

					// Update prevTimeVal which holds the last valid time value entered, and fire OnChange

					var dt = null;

					try
					{
						dt = Fit.Date.Parse(((inputTime.value !== "") ? inputTime.value : "00:00"), "hh:mm");
					}
					catch (err)
					{
					}

					if (dt === null) // Invalid value entered
						return;

					var newVal = Fit.Date.Format(dt, "hh:mm");

					if (newVal !== prevTimeVal)
					{
						prevTimeVal = newVal;

						if (input.value !== "")
							me._internal.FireOnChange();
					}
				}

				inputTime.onchange = function()
				{
					if (me === null)
					{
						// Fix for Chrome which fires OnChange and OnBlur (in both capturering and bubbling phase)
						// if control has focus while being removed from DOM, e.g. if used in a dialog closed using ESC.
						// More details here: https://bugs.chromium.org/p/chromium/issues/detail?id=866242
						return;
					}

					inputTime.onkeyup(null); // In case mouse was used to cut a value
				}

				inputTime.onpaste = function() // In case mouse was used to paste a value
				{
					setTimeout(function() // Postpone - OnPaste fires before pasted value is set
					{
						inputTime.onkeyup(null);
					}, 0);
				}

				inputTime.onblur = function()
				{
					if (me === null)
					{
						// Fix for Chrome which fires OnChange and OnBlur (in both capturering and bubbling phase)
						// if control has focus while being removed from DOM, e.g. if used in a dialog closed using ESC.
						// More details here: https://bugs.chromium.org/p/chromium/issues/detail?id=866242
						return;
					}

					if (inputTime.value === "")
					{
						inputTime.value = ((input.value !== "") ? "00:00" : "");
						prevTimeVal = "00:00";
					}
					else
					{
						// Use prevTimeVal which is properly formatted with leading zeros (see inputTime.onkeyup handler)
						inputTime.value = prevTimeVal;
					}
				}
				Fit.Dom.InsertAfter(input, inputTime);

				// Use native time picker on mobile devices (where touch is the primary pointing method).
				// However, do not do so on a hybrid device with support for both touch and mouse/pen.
				// On a device with a precision pointer, we most likely want to be able to accurately
				// place the text cursor in the time portion of the control to correct or enter a value
				// using the keyboard (psysical keyboard or virtual on-screen keyboard).
				if (isMobile === true && Fit.Device.HasMouse === false)
				{
					inputTimeMobile = document.createElement("input");
					inputTimeMobile.type = "time";
					inputTimeMobile.onchange = function()
					{
						if (inputTimeMobile.value === "" && inputMobile.value !== "")
							inputTimeMobile.value = "00:00";

						inputTime.value = inputTimeMobile.value; // Value is 24 hours hh:mm format (e.g. 22:43), even for devices with AM/PM picker
						inputTime.onchange();
					}
					me._internal.AddDomElement(inputTimeMobile);
				}

				me._internal.FireOnChange(); // Enabling Time causes Value() and Date() to return Date with timestamp - invoke event listeners
			}
			else if (val === false && inputTime !== null)
			{
				Fit.Dom.Remove(inputTime);

				if (inputTimeMobile !== null)
				{
					Fit.Dom.Remove(inputTimeMobile);
				}

				inputTime = null;
				inputTimeMobile = null;
				prevTimeVal = "";

				me._internal.FireOnChange(); // Disabling Time causes Value() and Date() to return Date without timestamp - invoke event listeners
			}

			me._internal.Data("time", (inputTime !== null).toString());
		}

		return (inputTime !== null);
	}

	/// <function container="Fit.Controls.DatePicker" name="DetectBoundaries" access="public" returns="boolean">
	/// 	<description>
	/// 		Get/set value indicating whether boundary/collision detection is enabled or not (off by default).
	/// 		This may cause calendar to open upwards if sufficient space is not available below control.
	/// 		If control is contained in a scrollable parent, this will be considered the active viewport,
	/// 		and as such define the active boundaries - unless relativeToViewport is set to True, in which
	/// 		case the actual browser viewport will be used.
	/// 	</description>
	/// 	<param name="val" type="boolean" default="undefined"> If defined, True enables collision detection, False disables it (default) </param>
	/// 	<param name="relativeToViewport" type="boolean" default="false">
	/// 		If defined, True results in viewport being considered the container to which available space is determined.
	/// 		This also results in calendar widget being positioned with position:fixed, allowing it to escape a container
	/// 		with overflow (e.g. overflow:auto|hidden|scroll). Be aware though that this does not work reliably in combination
	/// 		with CSS animation and CSS transform as it creates a new stacking context to which position:fixed becomes relative.
	/// 		A value of False (default) results in available space being determined relative to the boundaries of the
	/// 		control's scroll parent. The calendar widget will stay within its container and not overflow it.
	/// 	</param>
	/// </function>
	this.DetectBoundaries = function(val, relativeToViewport)
	{
		Fit.Validation.ExpectBoolean(val, true);
		Fit.Validation.ExpectBoolean(relativeToViewport, true);

		if (Fit.Validation.IsSet(val) === true)
		{
			detectBoundaries = val;
			detectBoundariesRelToViewPort = val === true && relativeToViewport === true;
		}

		return detectBoundaries;
	}

	/// <function container="Fit.Controls.DatePicker" name="Show" access="public">
	/// 	<description>
	/// 		Calling this function will open the calendar widget.
	/// 		Whether this results in picker being displayed on mobile depends on implementation.
	/// 		Often it will only work if Show() or Focused(true) is triggered by a user action such as a button click.
	/// 	</description>
	/// </function>
	this.Show = function()
	{
		if (isMobile === false)
		{
			initializeOnDemand(function()
			{
				if (Fit.Dom.IsVisible(me.GetDomElement()) === true)
				{
					var focused = Fit.Dom.GetFocused();

					datepicker.datepicker("show"); // Fails if not visible (part of render tree)

					var calendarWidget = document.getElementById("fitui-datepicker-div");
					calendarWidget._associatedFitUiControl = me.GetId();

					// Allow light dismissable panels/callouts to prevent close/dismiss
					// when interacting with calendar widget hosted outside of panels/callouts,
					// by detecting the presence of a data-disable-light-dismiss="true" attribute.
					Fit.Dom.Data(calendarWidget, "disable-light-dismiss", "true");

					moveCalenderWidgetLocally();

					if (focused === inputTime)
						inputTime.focus();
				}
			});
		}
		else
		{
			if (inputMobile.showPicker !== undefined) // Chrome 99+, Safari 16+, Firefox 101+, Edge 99+
			{
				inputMobile.showPicker();
			}
			else // This will bring up calendar widget in older browsers on mobile devices - doesn't work on desktop browsers running on hybrid computers (laptops with a touch screen)
			{
				me.Focused(false);
				me.Focused(true);
			}
		}
	}

	/// <function container="Fit.Controls.DatePicker" name="Hide" access="public">
	/// 	<description>
	/// 		Calling this function will close the calendar widget.
	/// 		Whether this results in picker being hidden on mobile depends on implementation.
	/// 		Often it will only work if Hide() or Focused(false) is triggered by a user action such as a button click.
	/// 	</description>
	/// </function>
	this.Hide = function()
	{
		if (isMobile === false)
		{
			if (datepicker !== null)
				datepicker.datepicker("hide");
		}
		else
		{
			me.Focused(false);
		}
	}

	/// <function container="Fit.Controls.DatePicker" name="GetLocales" access="public" returns="string[]">
	/// 	<description> Returns a string array containing supported locales </description>
	/// </function>
	this.GetLocales = function()
	{
		var locales = []

		Fit.Array.ForEach(getLocales(), function(locale)
		{
			if (locale === "") // Skip "" which in jQuery UI DatePicker is equivalent to "en" and "en-US"
				return;

			Fit.Array.Add(locales, locale);
		});

		return locales;
	}

	// ============================================
	// Private
	// ============================================

	function initializeOnDemand(cb) // Callback is invoked once datepicker is loaded
	{
		Fit.Validation.ExpectFunction(cb);

		if (datepicker !== null)
		{
			cb();
			return;
		}

		// jQUery instance is shared between multiple instances of DatePicker.
		// Testing multiple instances loading simultaneously: http://fiddle.jshell.net/se7qt8fj/15/
		jquery = Fit._internal.Controls.DatePicker.jQuery;

		if (jquery === undefined)
		{
			// jQuery has not been loaded yet

			jquery = null;
			Fit._internal.Controls.DatePicker.jQuery = null;

			// jQuery UI CSS has been added to Fit.UI.css to make overriding easier.
			// To load the stylesheet dynamically, consider moving overrides from
			// Controls/DatePicker/DatePicker.css to the bottom of jquery-ui.css.
			// Fit.Loader.LoadStyleSheet(Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/jquery-ui.css");

			// Load files

			Fit.Loader.ExecuteScript(Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/external/jquery/jquery.js?cacheKey=" + Fit.GetVersion().Version, function(src)
			{
				jquery = $;
				Fit._internal.Controls.DatePicker.jQuery = $; // jQuery instance is shared between multiple instances of DatePicker
				$.noConflict(true);

				Fit.Loader.ExecuteScript(Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/jquery-ui.js?cacheKey=" + Fit.GetVersion().Version, function(src)
				{
					if (me === null)
						return; // Control was disposed while waiting for jQuery UI to load

					createDatePicker();
					cb();

				}, null, { jQuery: jquery, $: jquery }); // Make jQuery accessible to jquery-ui.js
			});
		}
		else if (jquery && jquery.datepicker)
		{
			// jQuery and UI has already been loaded

			createDatePicker();
			cb();
		}
	}

	function createDatePicker()
	{
		var jq = jquery;

		datepicker = jq(input).datepicker(
		{
			showOn: "none", // Prevents datepicker from showing when input gains focus
			showAnim: false,
			showWeek: weeks, // Buggy - does not work if week starts on sunday: https://bugs.jqueryui.com/ticket/14907
			//firstDay: 1,
			changeMonth: true,
			changeYear: true,
			dateFormat: getJqueryUiDatePickerFormat(me.Format()),
			defaultDate: null,
			onChangeMonthYear: function(year, month, dp) // Fires when changing year/month but also when simply opening calendar widget
			{
				if (open === true) // Remember which year and month the user navigated to
				{
					try
					{
						// Fit.Date.Parse will throw an exception if the year is below 1000
						startDate = Fit.Date.Parse(year + "-" + month + "-" + "01", "YYYY-MM-DD");
					}
					catch (err)
					{
					}
				}
			},
			onSelect: function(dateText, dp) // Notice: jQuery UI DatePicker no longer fires input.OnChange when OnSelect is registered
			{
				startDate = null;
				input.focus(); // Do not use Focused(true) as it will not re-focus input, since control is already considered focused
				input.onchange();
			},
			beforeShow: function(elm, dp)
			{
				// Load locale if not already loaded

				if (datepicker.jq.datepicker.regional[locale] === null)
					return false; // Do not display - locale is currently loading (potentially started loading from another instance of DatePicker)

				if (datepicker.jq.datepicker.regional[locale] === undefined)
				{
					datepicker.jq.datepicker.regional[locale] = null; // Prevent multiple instances from loading the same locale

					Fit.Loader.ExecuteScript(Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/i18n/datepicker-" + locale + ".js?cacheKey=" + Fit.GetVersion().Version, function(src)
					{
						if (me === null)
						{
							return; // Control was disposed while waiting for locale to load
						}

						if (datepicker.jq.datepicker.regional[locale])
						{
							me.Show(); // Causes beforeShow to be fired again
						}

					}, null, { jQuery: datepicker.jq, $: datepicker.jq } // Make jQuery accessible to datepicker-xx.js
					);

					return false; // Do not display - wait for locale to load
				}

				// Update settings in case they were changed

				var val = me.Value();			// Always returns value in the YYYY-MM-DD[ hh:mm] format, but returns an empty string if value entered is invalid
				var actualValue = input.value;	// Since me.Value() returns an empty string if value is invalid, which might be the case if date is only partially entered, we keep the actual value entered as well

				if (updateCalConf === true) // Only update settings if actually changed, as this results in input value being updated, causing cursor position to change in IE
				{
					updateCalConf = false;

					datepicker.datepicker("option", datepicker.jq.datepicker.regional[locale]);
					datepicker.datepicker("option", "dateFormat", getJqueryUiDatePickerFormat(me.Format()));
					datepicker.datepicker("option", "showWeek", weeks);
				}

				if (startDate !== null && restoreView === true) // Restore year and month the user previously navigated to
				{
					setTimeout(function()
					{
						var year = Fit.Date.Format(startDate, "YYYY");
						var month = Fit.Date.Format(startDate, "M");

						var yearPicker = document.querySelector("select.fitui-datepicker-year");
						yearPicker.value = year;
						datepicker.jq(yearPicker).trigger("change");

						var monthPicker = document.querySelector("select.fitui-datepicker-month");
						monthPicker.value = (parseInt(month) - 1).toString();
						datepicker.jq(monthPicker).trigger("change");
					}, 0);
				}

				open = true;

				// The calendar widget clears the input value if it is invalid, which will be the case if user is in the process of entering a
				// value while the calendar widget is loading, or if a new locale is loaded with a format different from the one previously loaded.

				if (val === "" && actualValue !== "" && input.value === "")
				{
					// An invalid (possibly partial) date value was entered. The 'val' variable is empty because me.Value() returns an empty string for invalid
					// values, while 'actualValue' is not, as it originates from the input field directly. Since input.value is now empty, the calendar widget
					// has cleared the input field due to the invalid format. We therefore restore it to allow the user to proceed entering the value.
					input.value = actualValue;
				}
				else if (val !== me.Value())
				{
					// The calendar widget cleared the input field because locale loaded has a format different from the one previously loaded.
					// We restore it by re-assigning the 'val' value using me.Value(..) which uses the generic YYYY-MM-DD[ hh:mm] format.

					me._internal.ExecuteWithNoOnChange(function()
					{
						me.Value(val);
					});
				}
			},
			onClose: function(dateText, dp)
			{
				open = false;

				moveCalenderWidgetGlobally();

				// Make sure properly formatted value is used if user entered
				// the value manually and pressed ESC to close the calendar.
				// Calendar widget returns focus if closed using ESC key.
				input.onblur();

				// Calendar remains open if control lose focus while year or month picker is open (has focus).
				// In this case OnBlur does not fire for the control since elements within the calendar
				// widget is not part of the control (it lives in the root of the document), and therefore
				// does not inherit the automatic invocation of OnBlur and OnFocus.
				// This is unlikely to happen since it would require focus to programmatically be changed
				// while user is interacting with the year or month pickers. But if it does happen, we make
				// sure to fire OnBlur when the calendar widget closes, which happens when the user interacts
				// with something else on the page.
				// If the user decides to return focus to the control, it will not cause OnFocus to fire again,
				// without firing OnBlur in-between, thanks to the 'focused' flag.
				if (focused === true && Fit.Dom.GetFocused() !== input)
				{
					me._internal.FireOnBlur();
				}
			}
		});

		datepicker.jq = jq;
	}

	function moveCalenderWidgetLocally()
	{
		if (Fit._internal.ControlBase.ReduceDocumentRootPollution !== true)
		{
			return;
		}

		// We want the benefits of a connected calendar control (connected to input control),
		// but do not want it rendered in the root of the document. It pollutes the global scope,
		// and it doesn't work with dialogs with light dismiss, since interacting with the calendar
		// in the document root will close/dismiss such callouts.
		// Ideally we should move the calendar widget inside the control's container, but then it
		// would be affected by Fit.UI's styling which would cause issues with the visual appearance.
		// Instead we move it below the DatePicker control and make sure it is still properly positioned.
		// For more details see https://github.com/Jemt/Fit.UI/issues/116

		var selfDom = me.GetDomElement();
		var calendarWidget = document.getElementById("fitui-datepicker-div");

		Fit.Dom.InsertAfter(selfDom, calendarWidget);

		var below = true;
		var forceFixed = false;

		var overflowParent = (detectBoundariesRelToViewPort === false ? Fit.Dom.GetOverflowingParent(selfDom) : null); // Contrary to GetScrollParent(..), GetOverflowingParent(..) also take overflow:hidden into account
		var offsetParent = selfDom.offsetParent;

		if (overflowParent !== null && overflowParent !== offsetParent && Fit.Dom.Contained(overflowParent, offsetParent) === false)
		{
			// Control is contained in a parent with overflow:hidden|scroll|auto, but offsetParent,
			// which calendar widget is positioned against, it outside of overflow/scroll parent.
			// With position:absolute this would result in calendar widget scrolling along with the document,
			// but not when scrolling the scroll container, which would confuse the user. Force position:fixed.
			forceFixed = true;
		}

		if (detectBoundaries === true)
		{
			// Determine whether to position calendar widget below or above control

			var visualBoundaryBottomPosition = overflowParent !== null && forceFixed === false ? Fit.Dom.GetBoundingPosition(overflowParent).Y + overflowParent.offsetHeight : Fit.Browser.GetViewPortDimensions().Height;
			var controlBottomPosition = Fit.Dom.GetBoundingPosition(selfDom).Y + selfDom.offsetHeight;
			var spaceBelowControl = visualBoundaryBottomPosition - controlBottomPosition;
			var verticalScrollbarHeight = overflowParent !== null && detectBoundariesRelToViewPort === false && forceFixed === false ? Fit.Dom.GetScrollBars(overflowParent).Horizontal.Size : 0; // No need to compensate for scrollbars in viewport as Fit.Browser.GetViewPortDimensions() exclude these by default

			below = (spaceBelowControl >= calendarWidget.offsetHeight + verticalScrollbarHeight);
		}

		if (below === true) // Position calendar widget below control
		{
			if (detectBoundariesRelToViewPort === true || forceFixed === true) // Position relative to viewport (position:fixed) - can escape a container with overflow:hidden|scroll|auto
			{
				calendarWidget.style.position = "fixed";
				calendarWidget.style.left =  Fit.Dom.GetPosition(selfDom, true).X + "px";
				calendarWidget.style.top = (Fit.Dom.GetPosition(selfDom, true).Y + selfDom.offsetHeight) + "px";
			}
			else // Position relative to offsetParent (position:absolute)
			{
				calendarWidget.style.position = "absolute";
				calendarWidget.style.left = selfDom.offsetLeft + "px";
				calendarWidget.style.top = (selfDom.offsetTop + selfDom.offsetHeight) + "px";
			}
		}
		else // Position calendar widget above control
		{
			if (detectBoundariesRelToViewPort === true || forceFixed === true) // Position relative to viewport (position:fixed) - can escape a container with overflow:hidden|scroll|auto
			{
				calendarWidget.style.position = "fixed";
				calendarWidget.style.left =  Fit.Dom.GetPosition(selfDom, true).X + "px";
				calendarWidget.style.top = (Fit.Dom.GetPosition(selfDom, true).Y - calendarWidget.offsetHeight) + "px"
			}
			else // Position relative to offsetParent (position:absolute)
			{
				calendarWidget.style.position = "absolute";
				calendarWidget.style.left = selfDom.offsetLeft + "px";
				calendarWidget.style.top = (selfDom.offsetTop - calendarWidget.offsetHeight) + "px";
			}
		}
	}

	function moveCalenderWidgetGlobally() // Undo everything done in moveCalenderWidgetLocally()
	{
		if (Fit._internal.ControlBase.ReduceDocumentRootPollution !== true)
		{
			return;
		}

		var calendarWidget = document.getElementById("fitui-datepicker-div");
		Fit.Dom.Add(document.body, calendarWidget);

		calendarWidget.style.position = ""; // "absolute"
		calendarWidget.style.left = "";
		calendarWidget.style.top = "";
	}

	function getJqueryUiDatePickerFormat()
	{
		return me.Format().replace(/D/g, "d").replace(/M/g, "m").replace(/YY/g, "y");
	}

	function getFitUiDateFormat(jqueryFormat) // jquery.datepicker.regional["da"].dateFormat
	{
		Fit.Validation.ExpectString(jqueryFormat);
		return jqueryFormat.replace(/d/g, "D").replace(/m/g, "M").replace(/y/g, "YY");
	}

	function getJqueryDateFormatFromLocale(lc)
	{
		Fit.Validation.ExpectString(lc);

		var locales = getLocales();

		if (locales[lc] !== undefined)
			return locales[lc];

		return null;
	}

	function getLocales()
	{
		// List of locales was generated this way:
		// 1) Make sure to prepare locales first like described in README-FitUiCustomJqueryUiBuild.txt
		// 2) Merge all i18n files using Bash:
		//    # cd Resources/JqueryUI-1.11.4.custom/i18n
		//    # echo "" > merged.js && for file in `ls datepicker-*js` ; do cat $file >> merged.js ; done
		// 3) Execute JS code in a page running Fit.UI:
		//    # var jq = Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/external/jquery/jquery.js";
		//    # var ui = Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/jquery-ui.js?FitJquery";
		//    # var ln = Fit.GetUrl() + "/Resources/JqueryUI-1.11.4.custom/i18n/merged.js?FitJquery";
		//    # Fit.Loader.LoadScripts([ { source: jq, loaded: function(src) { FitJquery = $; $.noConflict(true); } }, { source: ui }, { source: ln } ], function(cfgs)
		//    # {
		//    # 	var regional = FitJquery.datepicker.regional;
		//    # 	var res = {};
		//    # 	for (lang in regional)
		//    # 	{
		//    # 		if (regional[lang].dateFormat) // Make sure property is a language
		//    # 			res[lang] = regional[lang].dateFormat;
		//    # 	}
		//    #
		//    # 	console.log(JSON.stringify(res));
		//    # });
		// 4) Insert JSON written to console into variable below.

		return {"":"mm/dd/yy","en":"mm/dd/yy","en-US":"mm/dd/yy","da":"dd-mm-yy","af":"dd/mm/yy","ar-DZ":"dd/mm/yy","ar":"dd/mm/yy","az":"dd.mm.yy","be":"dd.mm.yy","bg":"dd.mm.yy","bs":"dd.mm.yy","ca":"dd/mm/yy","cs":"dd.mm.yy","cy-GB":"dd/mm/yy","de":"dd.mm.yy","el":"dd/mm/yy","en-AU":"dd/mm/yy","en-GB":"dd/mm/yy","en-NZ":"dd/mm/yy","eo":"dd/mm/yy","es":"dd/mm/yy","et":"dd.mm.yy","eu":"yy-mm-dd","fa":"yy/mm/dd","fi":"d.m.yy","fo":"dd-mm-yy","fr-CA":"yy-mm-dd","fr-CH":"dd.mm.yy","fr":"dd/mm/yy","gl":"dd/mm/yy","he":"dd/mm/yy","hi":"dd/mm/yy","hr":"dd.mm.yy.","hu":"yy.mm.dd.","hy":"dd.mm.yy","id":"dd/mm/yy","is":"dd.mm.yy","it-CH":"dd.mm.yy","it":"dd/mm/yy","ja":"yy/mm/dd","ka":"dd-mm-yy","kk":"dd.mm.yy","km":"dd-mm-yy","ko":"yy. m. d.","ky":"dd.mm.yy","lb":"dd.mm.yy","lt":"yy-mm-dd","lv":"dd.mm.yy","mk":"dd.mm.yy","ml":"dd/mm/yy","ms":"dd/mm/yy","nb":"dd.mm.yy","nl-BE":"dd/mm/yy","nl":"dd-mm-yy","nn":"dd.mm.yy","no":"dd.mm.yy","pl":"dd.mm.yy","pt-BR":"dd/mm/yy","pt":"dd/mm/yy","rm":"dd/mm/yy","ro":"dd.mm.yy","ru":"dd.mm.yy","sk":"dd.mm.yy","sl":"dd.mm.yy","sq":"dd.mm.yy","sr":"dd.mm.yy","sr-SR":"dd.mm.yy","sv":"yy-mm-dd","ta":"dd/mm/yy","th":"dd/mm/yy","tj":"dd.mm.yy","tr":"dd.mm.yy","uk":"dd.mm.yy","vi":"dd/mm/yy","zh-CN":"yy-mm-dd","zh-HK":"dd-mm-yy","zh-TW":"yy/mm/dd"};
	}

	function getDatePlaceholder()
	{
		return (placeholderDate !== null ? placeholderDate : Fit.Date.Format(new Date(), format));
	}

	function getTimePlaceholder()
	{
		return (placeholderTime !== null ? placeholderTime : Fit.Date.Format(new Date(), "hh:mm"));
	}

	function setLocale(val)
	{
		Fit.Validation.ExpectString(val);

		var newFormat = getJqueryDateFormatFromLocale(val); // Null if locale does not exist

		if (newFormat === null)
			Fit.Validation.ThrowError("Unknown locale '" + val + "'");

		var wasOpen = open;

		if (wasOpen === true)
		{
			restoreView = true;
			me.Hide();
		}

		locale = val;
		updateCalConf = true; // Update calendar widget settings

		if (formatEnforced === false)
		{
			setFormat(getFitUiDateFormat(newFormat));
		}

		if (wasOpen === true)
		{
			me.Show();
			restoreView = false;
		}
	}

	function setFormat(val)
	{
		Fit.Validation.ExpectString(val);

		// Validate format

		try
		{
			// Notice: Fit.Date.Parse(..) produces a DateTime object that contains
			// current Hours:Minutes:Seconds unless explicitly set, so we need to set
			// those to prevent 'date' and 'parsed' variables from differing one second.

			var date = Fit.Date.Parse("2016-06-24 00:00:00", "YYYY-MM-DD hh:mm:ss");
			var dateStr = Fit.Date.Format(date, val + " hh:mm:ss");
			var parsed = Fit.Date.Parse(dateStr, val + " hh:mm:ss");

			if (date.getTime() !== parsed.getTime())
				throw "Invalid"; // Catched below and re-thrown
		}
		catch (err)
		{
			Fit.Validation.ThrowError("Invalid date format '" + val + "'");
		}

		// Set format

		var wasOpen = open;

		if (wasOpen === true)
		{
			restoreView = true;
			me.Hide();
		}

		var curDate = me.Date(); // The format is used by Value(), which is called by Date(), to parse the date entered - get DateTime value before changing format

		format = val;
		updateCalConf = true; // Update calendar widget settings
		input.placeholder = getDatePlaceholder();

		// Update input with new format
		me._internal.ExecuteWithNoOnChange(function()
		{
			if (curDate !== null)
			{
				// Update input directly rather than using Value(..) since the input field still contains
				// the old value which is formatted using the old format. This will cause a call to Value(..)
				// to fail since it cannot parse the old string value using the new format applied.
				// Notice that we only change the format of the DateTime value - not the actual date or time.
				// Therefore, there is no need to update curVal.

				input.value = Fit.Date.Format(curDate, format);
				preVal = input.value;
			}
		});

		if (wasOpen === true)
		{
			me.Show();
			restoreView = false;
		}
	}

	function localize()
	{
		if (localeEnforced === true)
			return;

		var newLocale = Fit.Internationalization.Locale();
		var key = null;

		// Transform Fit.UI's locale format (e.g. en or en_gb) to jQuery's locale format (e.g. en or en-GB)

		if (newLocale.indexOf("_") !== -1) // E.g. de_AT
		{
			var info = newLocale.split("_");
			key = info[0].toLowerCase() + "-" + info[1].toUpperCase();
		}
		else // e.g. de
		{
			key = newLocale.toLowerCase();
		}

		// Update locale

		// Make sure locale exists - otherwise setLocale throws an error
		if (Fit.Array.Contains(Fit.Array.GetKeys(getLocales()), key) === true)
		{
			setLocale(key);
		}
	}

	init();
}

Fit._internal.Controls.DatePicker = {};
