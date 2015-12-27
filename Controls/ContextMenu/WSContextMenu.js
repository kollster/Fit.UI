/// <container name="Fit.Controls.WSContextMenu">
/// 	ContextMenu control allowing for quick access to select features provided by a WebService.
/// 	Inheriting from Fit.Controls.ContextMenu.
/// </container>

/// <function container="Fit.Controls.WSContextMenu" name="WSContextMenu" access="public">
/// 	<description> Create instance of WSContextMenu control </description>
/// </function>
Fit.Controls.WSContextMenu = function()
{
	Fit.Core.Extend(this, Fit.Controls.ContextMenu).Apply();

	var me = this;
	var url = null;

	var onRequestHandlers = [];
	var onResponseHandlers = [];
	var onPopulatedHandlers = [];

	// ============================================
	// Init
	// ============================================

	function init()
	{
	}

	// ============================================
	// Public
	// ============================================

	this.Show = function(x, y)
	{
		Fit.Validation.ExpectInteger(x, true);
		Fit.Validation.ExpectInteger(y, true);

		// Fire OnShowing event

		if (me._internal.FireOnShowing() === false)
			return;

		// Close context menu if one is already open

		if (Fit._internal.ContextMenu.Current !== null && Fit._internal.ContextMenu.Current !== me && Fit._internal.ContextMenu.Current.IsVisible() === true)
		{
			Fit._internal.ContextMenu.Current.Hide();
			Fit._internal.ContextMenu.Current = null;
		}

		// Load data

		getData(function(eventArgs)
		{
			// Populate data received

			me.RemoveAllChildren();

			Fit.Array.ForEach(eventArgs.Children, function(c)
			{
				me.AddChild(createItemFromJson(c));
			});

			// Set position

			var pos = Fit.Events.GetPointerState().Coordinates.Document;

			var posX = ((Fit.Validation.IsSet(x) === true) ? x : pos.X);
			var posY = ((Fit.Validation.IsSet(y) === true) ? y : pos.Y);

			me.GetDomElement().style.left = posX + "px";
			me.GetDomElement().style.top = posY + "px";
			me.GetDomElement().style.width = "auto"; // TreeView.Width(val, unit) cannot be used to set width:auto

			// Add to DOM (context menu shows up)

			if (me.IsVisible() === false) // Only append to DOM once - ContextMenu may have been rooted elsewhere by external code
			{
				Fit.Dom.Add(document.body, me.GetDomElement());
				Fit._internal.ContextMenu.Current = me;
			}

			// Focus context menu

			me.Focused(true);

			// Fire OnShown event

			me._internal.FireOnShown();
		});
	}

	/// <function container="Fit.Controls.WSContextMenu" name="Url" access="public" returns="string">
	/// 	<description>
	/// 		Get/set URL to WebService responsible for providing data to ContextMenu.
	/// 		WebService must deliver all data at once in the following JSON format:
	/// 		[
	/// 			&#160;&#160;&#160;&#160; { Title: "Test 1", Value: "1001", Selectable: true, Selected: true, Children: [] },
	/// 			&#160;&#160;&#160;&#160; { Title: "Test 2", Value: "1002", Selectable: false, Selected: false, Children: [] }
	/// 		]
	/// 		Only Value is required. Children is a collection of items with the same format as described above.
	/// 	</description>
	/// 	<param name="wsUrl" type="string"> WebService URL - e.g. http://server/ws/data.asxm/GetItems </param>
	/// </function>
	this.Url = function(wsUrl)
	{
		Fit.Validation.ExpectString(wsUrl, true);

		if (Fit.Validation.IsSet(wsUrl) === true)
		{
			url = wsUrl;
		}

		return url;
	}

	// ============================================
	// Events
	// ============================================

	/// <function container="Fit.Controls.WSContextMenu" name="OnRequest" access="public">
	/// 	<description>
	/// 		Add event handler fired when data is being requested.
	/// 		Request can be canceled by returning False.
	/// 		Function receives two arguments:
	/// 		Sender (Fit.Controls.WSContextMenu) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.WSContextMenu instance
	/// 		 - Request: Fit.Http.Request or Fit.Http.JsonRequest instance
	/// 	</description>
	/// 	<param name="cb" type="function"> Event handler function </param>
	/// </function>
	this.OnRequest = function(cb)
	{
		Fit.Validation.ExpectFunction(cb);
		Fit.Array.Add(onRequestHandlers, cb);
	}

	/// <function container="Fit.Controls.WSContextMenu" name="OnResponse" access="public">
	/// 	<description>
	/// 		Add event handler fired when data is received,
	/// 		allowing for data transformation to occure before
	/// 		ContextMenu is populated. Function receives two arguments:
	/// 		Sender (Fit.Controls.WSContextMenu) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.WSContextMenu instance
	/// 		 - Request: Fit.Http.Request or Fit.Http.JsonRequest instance
	/// 		 - Children: JSON items received from WebService
	/// 	</description>
	/// 	<param name="cb" type="function"> Event handler function </param>
	/// </function>
	this.OnResponse = function(cb)
	{
		Fit.Validation.ExpectFunction(cb);
		Fit.Array.Add(onResponseHandlers, cb);
	}

	/// <function container="Fit.Controls.WSContextMenu" name="OnPopulated" access="public">
	/// 	<description>
	/// 		Add event handler fired when ContextMenu has been populated with items.
	/// 		Function receives two arguments:
	/// 		Sender (Fit.Controls.WSContextMenu) and EventArgs object.
	/// 		EventArgs object contains the following properties:
	/// 		 - Sender: Fit.Controls.WSContextMenu instance
	/// 		 - Request: Fit.Http.Request or Fit.Http.JsonRequest instance
	/// 		 - Children: JSON items received from WebService
	/// 	</description>
	/// 	<param name="cb" type="function"> Event handler function </param>
	/// </function>
	this.OnPopulated = function(cb)
	{
		Fit.Validation.ExpectFunction(cb);
		Fit.Array.Add(onPopulatedHandlers, cb);
	}

	// ============================================
	// Private
	// ============================================

	function getData(cb)
	{
		Fit.Validation.ExpectFunction(cb);

		if (url === null)
			Fit.Validation.ThrowError("Unable to get data, no WebService URL has been specified");

		var request = ((url.toLowerCase().indexOf(".asmx/") === -1) ? new Fit.Http.Request(url) : new Fit.Http.JsonRequest(url));

		// Fire OnRequest

		var eventArgs = { Sender: null, Request: null, Children: null };
		eventArgs.Sender = me;
		eventArgs.Request = request;

		if (fireEventHandlers(onRequestHandlers, eventArgs) === false)
			return;

		// Set request callbacks

		request.OnSuccess(function(req)
		{
			var children = request.GetResponseJson();

			// Fire OnResponse

			eventArgs.Children = ((children instanceof Array) ? children : []);
			fireEventHandlers(onResponseHandlers, eventArgs);

			// Fire getData callback

			cb(eventArgs); // Callback is responsible for populating Context Menu

			// Fire OnPopulated

			fireEventHandlers(onPopulatedHandlers, eventArgs);
		});

		request.OnFailure(function(req)
		{
			Fit.Validation.ThrowError("Unable to load data for context menu - request failed with HTTP Status code " + request.GetHttpStatus())
		});

		// Invoke request

		request.Start();
	}

	function createItemFromJson(jsonNode)
	{
		Fit.Validation.ExpectIsSet(jsonNode);

		// Convert JSON to ContextMenu item, including all contained children

		var item = new Fit.Controls.ContextMenu.Item((jsonNode.Title ? jsonNode.Title : jsonNode.Value), jsonNode.Value);

		if (jsonNode.Selectable !== undefined)
			item.Selectable((jsonNode.Selectable === true));

		if (jsonNode.Children instanceof Array)
		{
			Fit.Array.ForEach(jsonNode.Children, function(c)
			{
				item.AddChild(createItemFromJson(c));
			});
		}

		return item;
	}

	function fireEventHandlers(handlers, eventArgs)
	{
		var cancel = false;

		Fit.Array.ForEach(handlers, function(cb)
		{
			if (cb(me, eventArgs) === false)
				cancel = true; // Do NOT cancel loop though! All handlers must be fired!
		});

		return !cancel;
	}

	init();
}
