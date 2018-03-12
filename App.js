(function () {
    var Ext = window.Ext4 || window.Ext;
    var gApp = null;

    Ext.define('typesToChoose', {
    extend: 'Ext.data.Model',
    fields: [
        {name: 'name',    type: 'string' },
        {name: '_ref',    type: 'string' },
        {name: 'lbapi',   type: 'string' },
        {name: 'field',   type: 'string' }
    ],

    // To help the rallycombobox, we need to provide some equivalents
    getNonCollectionFields: function() {
        return this.fields;
    }
});

Ext.define('Niks.Apps.TimeInState', {
    extend: 'Rally.app.App',
    alias: 'widget.tisApp',
    componentCls: 'app',
    stateful: true,
    typeStore: null,
    itemId: 'rallyApp',
    id: 'rallyApp',
    config: {
        defaultSettings: {
            artefactType: 'hierarchicalrequirement',
            piType: 'Portfolioitem/Feature',
        }
    },

    getSettingsFields: function() {

        var returnVal = [{
                xtype: 'rallycombobox',
                name: 'artefactType',
                fieldLabel: 'Artefact Type:',
                // stateful: true,
                // stateId: this.getContext().getScopedStateId('artefactcombo'),
                storeType: 'Ext.data.Store',
                store: this.store,
                displayField: 'name',
                labelAlign: 'right',
                labelWidth: 150

            },
            {
                xtype: 'rallyportfolioitemtypecombobox',
                fieldLabel: 'PI Type (if selected):',
                // stateful: true,
                // stateId: this.getContext().getScopedStateId('picombo'),
                name: 'piType',
                labelAlign: 'right',
                labelWidth: 150,
                valueField: 'TypePath',
            }
        ];

        return returnVal;

    },


    items: [
    {
            xtype: 'container',
            id: 'headerBox',
            layout: 'column',
            border: 5,
            style: {
                borderColor: Rally.util.Colors.cyan,
                borderStyle: 'solid'
            },
            items: [
                {
                    xtype: 'rallydatefield',
                    margin: 10,
                    format: 'D d M Y',
                    id: 'StartDate',
                    stateful: true,
                    fieldLabel: 'Start Date',
                    value: Ext.Date.subtract( new Date(), Ext.Date.DAY, 90) // 90 days of previous iterations
                },
                {
                    xtype: 'rallydatefield',
                    margin: 10,
                    fieldLabel: 'End Date',
                    format: 'D d M Y',
                    stateful: true,
                    id: 'EndDate',
                    value: new Date()
                },
            ]
        }
    ],

    _getCalculatorConfig: function() {
        return ({
            'endDate': Ext.getCmp('EndDate').getValue(),
            'startDate': Ext.getCmp('StartDate').getValue(),
            'granularity': 'day'
        });
    },

    _getSeriesData: function(app) {
        //Find the field name for the relevant type in our little table because of the inconsistencies of WSAPI/LBAPI
        var typeRecord = _.find(this.possibleTypes, {'_ref' : app.artefactType});
        var typeName = typeRecord.lbapi;
        if (typeName === 'PortfolioItem') {
            typeName = app.piType;
        }

        var fieldName = gApp.down('#fieldCombo').value;
        var snapshots = Ext.create('Rally.data.lookback.SnapshotStore', {
            autoLoad: false,
            defaultFetch: ['ObjectID', '_ValidFrom', '_ValidTo' ],
            compress: true,
            removeUnauthorizedSnapshots: true,
            pageSize: 15000,
            fetch: [fieldName],
            hydrate: [fieldName], //Hydrate  the field we are looking for first (used in _gotSnapShots() )
            filters: [
                {
                    property: '_TypeHierarchy',
                    operator: 'in',
                    value: [typeName]
                },
                {
                    property: fieldName,
                    operator: 'in',
                    value: app.categoryData
                },
                {
                    property: '_ValidFrom',
                    operator: '>',
                    value:  Ext.Date.format(Ext.getCmp('StartDate').value, "Y-m-d\\TH:i:s.u\\Z")
                },
                {
                    property: '_ValidTo',
                    operator: '<',
                    value: Ext.Date.format(Ext.getCmp('EndDate').value, "Y-m-d\\TH:i:s.u\\Z")
                }

            ],
            sorters: [
                {
                    property: 'ObjectID',
                    direction: 'ASC'
                },
                {
                    property: '_ValidFrom',
                    direction: 'ASC'
                }
            ],
            listeners: {
                load: app._gotSnapShots,
                scope: app
            },

            storeConfig: {
                limit: Infinity
            }
        });

        snapshots.load();
    },

    _findItem: function( data, fieldsToMatch) {
        var keys = _.keys(fieldsToMatch);
        var keylength = keys.length;

        if ((data !== null) && (keylength !== 0))
        {
            for (var j = 0; j < data.length; j++) {
                var record = data[j];

                var obj = Object(record.data);   //WHo knows why this is in the example code....
                var i = 0;
                for ( i = 0; i< keylength; i++ ) {
                    var key = keys[i];
                    if (fieldsToMatch[key] !== obj[key] || !(key in obj)) { break; }
                }

                //If we get here after checking all the keys, then found the right stuff in this record
                if ( i >= keylength) return record;
            }
        }
        return null;
    },

    _gotSnapShots: function( store, data, success) {

        var app = this;
        console.log('Snapshots received: ', data.length);

        //For all the snapshots we have, check the state change regardless of the 'Project' changing.
        //The snapshots will be all those that states start and finish within the timebox specified.

        //We need to merge the 'project' changes for each Object

        // Then we have the issue of objects that move back and forth between states.
        // So, let's total up how long each object was in a particular state regardless of when it was moved project

        var savedItems = [];
        var hydratedField = store.hydrate[0];

        _.each(data, function(item) {
            var foundItem = null;
            var findThese = {};
            findThese.ObjectID = item.get('ObjectID');
            findThese[hydratedField] = item.get(hydratedField);

            d1 = new Date(item.get('_ValidFrom'));
            d2 = new Date(item.get('_ValidTo'));

            if ((foundItem = app._findItem(savedItems, findThese)
                )) {
                //It's in savedItems, so move its end date out by the amount in the new item
                //The _ValidTo and _ValidFrom fields are strings, so we need to convert, manipulate and place back.
                d_ = foundItem.get('TimeDiff');
                d3 = (d_?d_:0);
                foundItem.set('TimeDiff', d3 + (d2 - d1));
            }
            else {
                //Don't know about it, so add to the saveitems array
                item.set('TimeDiff', d2 - d1);
                savedItems.push(item);
            }
        });
        
        console.log('Saved items: ', savedItems);
        //Let's now scan the saveItems to generate some stats

        //Create a matching set of artefactData to categoryData
        for (var i = 0; i < app.categoryData.length; i++ ){ 
            console.log('Creating artefactData array for ', app.categoryData[i]);
            app.artefactData[i] = []; 
        }

        //First collect all the time diffs (in ms)
        _.each (savedItems, function(item) {

            //Deal with an empty field - Rally changes these to 'None' in the allowed Values
            if (item.data[hydratedField] === '' ) { item.data[hydratedField] = 'None'; }

            //Find the item state in the category list.
            if ((index = app.categoryData.indexOf(item.data[hydratedField])) >= 0) {

                //We have an issue with people creating and moving in the same action.
                //It skews the data to show that the minimum is 'zero'. To get around this, we
                //only save data where the granularity is  more than one hour.

                if (item.data.TimeDiff > (60*60*1000)) {
                    app.artefactData[index].push(item.data.TimeDiff);
                }
            }
        });

        var dataArray = [];

        //For each entry, calculate some 'real' stats ready for diisplay
        _.each( app.artefactData, function(adArray) {
            sortedArray = _.sortBy(adArray);
            var stats = [];
            var sum = 0;
            var i = 0;

            // If we filter off the smaller timeboxes
            if ( adArray.length > 0){
                for (i = 0; i < adArray.length; i++) { sum += adArray[i]; }
                stats.push(Math.floor(_.min(adArray)/864000)/100);
                stats.push(Math.floor(sortedArray[Math.floor(i*0.25)]/864000)/100);
                stats.push(Math.floor(sum/(864000*adArray.length))/100);
                stats.push(Math.floor(sortedArray[Math.floor(i*0.75)]/864000)/100);
                stats.push(Math.floor(_.max(adArray)/864000)/100);
                dataArray.push(stats);
            }
        });

        //So we have the same order of samples as the categoryData

        app.seriesData =
            [{
                name: hydratedField,
                data: dataArray
            }];
            app._drawChart();
    },

    //Hold  blank data for the graph until load

    artefactType: null,

    artefactData: {},

    categoryData: [],

    seriesData: [],

    possibleTypes: [
        { name: 'Stories',   _ref: 'hierarchicalrequirement',   lbapi: 'HierarchicalRequirement',  field: 'ScheduleState' },
        { name: 'Defects',   _ref: 'defect',                    lbapi: 'Defect',                   field: 'ScheduleState'    },
        { name: 'Tasks',     _ref: 'task',                      lbapi: 'Task',                     field: 'State'   },
        { name: 'TestCases', _ref: 'testcase',                  lbapi: 'TestCase',                 field: 'LastVerdict'   },
        { name: 'Portfolio', _ref: 'portfolioitem',             lbapi: 'PortfolioItem',            field: 'State' }
    ],

    _restart: function() {
        var chart = null;

        if ( (chart = Ext.getCmp('tipChart')) ) {
            chart.destroy();
        }

        gApp.artefactData = {};
        gApp.seriesData = [];
        gApp.categoryData = Ext.getCmp('fieldValueCombo').value;
        gApp._getSeriesData(gApp);
    },

    _drawChart: function() {
        var hc = Ext.create('Rally.ui.chart.Chart', {
            id: 'tipChart',
            loadMask: false,
            chartData:{
                categories: this.categoryData,
                series: this.seriesData
            },

             chartConfig: {
                chart: {
                    type: 'boxplot',
                    marginRight: 130,
                    marginBottom: 25
                },
                title: {
                    text: 'Time In State for Period',
                    x: -20 //center
                },
                subtitle: {
                    text: 'Min, 25%, Average, 75%, Max',
                    x: -20
                },
                yAxis: {
                    min: 0,
                    title: {
                        text: 'Days in State'
                    }
                },

                  plotOptions: {
                    columnrange: {
                        dataLabels: {
                            enabled: true,
                            formatter: function () {
                                return this.y + 'days';
                            }
                        }
                    }
                  },

                  legend: {
                    enabled: false
                  }
          }
       });

        this.add(hc);
    },

    onSettingsUpdate: function() {
        this._kickOff();
    },

    _getFieldComboBoxConfig: function(typeRecord) {
        
        //Add the field selector for the user
        var typeName = typeRecord._ref;
        if (typeName === 'portfolioitem') {
            typeName = this.piType.toLowerCase();
        }
                
        return {
            xtype: 'rallyfieldcombobox',
            model: typeName,
            autoScroll: true,
            stateful: true,
            stateId: Ext.id() + 'fieldCombo',
            fieldLabel: typeRecord.name + ' Field:',
            id: 'fieldCombo',
            margin: 10,
            listeners: {
                ready: function(fldCombo) {
                    fldCombo.store.filterBy(function(record) {
                        var attr = record.get('fieldDefinition').attributeDefinition;
                            return attr && attr.Constrained && attr.AttributeType !== 'COLLECTION';
                    });
                    //Send completion back to app after filter
                    gApp.fireEvent('storeFiltered');
                },
                //And also ping fieldValueCombo on user selection from here
                select: function(fldCombo) {
                    gApp.down('#fieldValueCombo').fireEvent('fieldselected', fldCombo.getRecord().get('fieldDefinition'));
                }    
            },
            allowNoEntry: false,
            allowBlank: false
        };
    },

    _getFieldValueComboBoxConfig: function() {
        //Get the cuurent state of the field selector
        var cmbo = gApp.down('#fieldCombo');
        var field = cmbo.getValue();
        var model = cmbo.getModel();
        return {
            xtype: 'rallyfieldvaluecombobox',
            id: 'fieldValueCombo',
            model: model.typePath,
            stateful: true,
            stateId: Ext.id() + 'fieldValueCombo',
            field: cmbo.getValue(),
            fieldLabel: cmbo.getRawValue() + ' Values: ',
            labelWidth: 150,
            valueField: 'name',
            multiSelect: true,
            margin: 10,
            allowNoEntry: false,
            allowBlank: false,
            listeners: {
                fieldselected: function(type) {
                    this.setField(type);
                    this.setFieldLabel(cmbo.getRawValue() + ' Values: ');
                },
                setvalue: function(combo,values) {
                    gApp.fireEvent('fieldValuesSelected');
                }
            }
        };

    },

    _createFieldValueCombo: function() {
        var fvCombo = this.down('#fieldValueCombo');
        if ( fvCombo) { fvCombo.destroy(); }
        var fieldValueConfig = this._getFieldValueComboBoxConfig();
        var fieldValueCombo = Ext.create('Rally.ui.combobox.FieldValueComboBox', fieldValueConfig);
        this.down('#headerBox').add(fieldValueCombo);
    },

    _createFieldCombo: function() {
        //On model change, we need to reload the new fields
        var fldCombo = this.down('#fieldCombo');
        if ( fldCombo) { fldCombo.destroy(); }

        //Now that we know what type...
        var typeRecord = _.find(this.possibleTypes, {'_ref' : this.artefactType});
        var fieldConfig = this._getFieldComboBoxConfig(typeRecord);
        var fieldCombo = Ext.create('Rally.ui.combobox.FieldComboBox', fieldConfig);
        this.down('#headerBox').add(fieldCombo);
    },

    launch: function() {

        gApp = this;    //Store away for later

        //Create a store to house our records
        this.store = Ext.create('Ext.data.Store',{
            model: 'typesToChoose',
            data:   gApp.possibleTypes,
            proxy: 'memory',
            autoLoad: false

        });

        this.addListener( {
            storeFiltered: function() {
                this._createFieldValueCombo();
            }
        });

        this.addListener( {
            fieldValuesSelected: function() {
                //We need to 'debounce' the calls to here as there are quite a few when the app starts up
                // and also when the user selects items
                this._resetTimer(this._restart);
                
            }
        });

        this._kickOff();
    },

    _kickOff: function() {
        //We need to get the original settings
        this.artefactType = this.getSetting('artefactType') || 'hierarchicalrequirement';
        this.piType = this.getSetting('piType') || 'Portfolioitem/Feature';

                
        Ext.getCmp('StartDate').on('change', gApp._restart, gApp);
        Ext.getCmp('EndDate').on('change', gApp._restart, gApp);

        //Kick it all off....
        this._createFieldCombo();
    },

    _resetTimer: function(callFunc) {
        if ( this.timer) { clearTimeout(this.timer);}
        this.timer = setTimeout(callFunc, 2000);    //Debounce calls to the tune of half a second
    },
});
}());