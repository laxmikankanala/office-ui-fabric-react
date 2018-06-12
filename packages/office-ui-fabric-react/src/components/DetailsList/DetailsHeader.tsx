import * as React from 'react';
import { findDOMNode } from 'react-dom';
import {
  BaseComponent,
  css,
  getRTL,
  getId,
  KeyCodes,
  IRenderFunction,
  createRef
} from '../../Utilities';
import { IColumn, DetailsListLayoutMode } from './DetailsList.types';
import { IFocusZone, FocusZone, FocusZoneDirection } from '../../FocusZone';
import { Icon } from '../../Icon';
import { Layer } from '../../Layer';
import { GroupSpacer } from '../GroupedList/GroupSpacer';
import { CollapseAllVisibility } from '../../GroupedList';
import { DetailsRowCheck } from './DetailsRowCheck';
import { ITooltipHostProps } from '../../Tooltip';
import * as checkStylesModule from './DetailsRowCheck.scss';
import { IViewport } from '../../utilities/decorators/withViewport';
import { ISelection, SelectionMode, SELECTION_CHANGE } from '../../utilities/selection/interfaces';
import * as stylesImport from './DetailsHeader.scss';
import { IDragDropOptions } from './../../utilities/dragdrop/interfaces';
import { DragDropHelper } from './../../utilities/dragdrop';
import { DetailsColumn } from './../../components/DetailsList/DetailsColumn';

const styles: any = stylesImport;
const checkStyles: any = checkStylesModule;

const MOUSEDOWN_PRIMARY_BUTTON = 0; // for mouse down event we are using ev.button property, 0 means left button
const MOUSEMOVE_PRIMARY_BUTTON = 1; // for mouse move event we are using ev.buttons property, 1 means left button

export interface IDetailsHeader {
  focus: () => boolean;
}

export interface IDetailsHeaderProps extends React.Props<DetailsHeader> {
  componentRef?: (component: IDetailsHeader | null) => void;
  columns: IColumn[];
  selection: ISelection;
  selectionMode: SelectionMode;
  layoutMode: DetailsListLayoutMode;
  onColumnIsSizingChanged?: (column: IColumn, isSizing: boolean) => void;
  onColumnResized?: (column: IColumn, newWidth: number, columnIndex: number) => void;
  onColumnAutoResized?: (column: IColumn, columnIndex: number) => void;
  onColumnClick?: (ev: React.MouseEvent<HTMLElement>, column: IColumn) => void;
  onColumnContextMenu?: (column: IColumn, ev: React.MouseEvent<HTMLElement>) => void;
  onRenderColumnHeaderTooltip?: IRenderFunction<ITooltipHostProps>;
  groupNestingDepth?: number;
  indentWidth?: number;
  collapseAllVisibility?: CollapseAllVisibility;
  isAllCollapsed?: boolean;
  onToggleCollapseAll?: (isAllCollapsed: boolean) => void;
  /** ariaLabel for the entire header */
  ariaLabel?: string;
  /** ariaLabel for the header checkbox that selects or deselects everything */
  ariaLabelForSelectAllCheckbox?: string;
  ariaLabelForSelectionColumn?: string;
  selectAllVisibility?: SelectAllVisibility;
  viewport?: IViewport;
  columnReorderOptions?: IColumnReorderOptions | null;
  minimumPixelsForDrag?: number;
}

export enum SelectAllVisibility {
  none = 0,
  hidden = 1,
  visible = 2
}

export interface IDetailsHeaderState {
  columnResizeDetails?: IColumnResizeDetails;
  isAllSelected?: boolean;
  isSizing?: boolean;
  groupNestingDepth?: number;
  isAllCollapsed?: boolean;
}

export interface IColumnResizeDetails {
  columnIndex: number;
  originX?: number;
  columnMinWidth: number;
}

export interface IDropHintDetails {
  originX: number; // X index of dropHint Element relative to header
  startX: number; // start index of the range for the current drophint
  endX: number; // end index of the range for the current drophint
  dropHintElementRef: HTMLElement; // Reference for drophint to change the style when needed
}

export class DetailsHeader extends BaseComponent<IDetailsHeaderProps, IDetailsHeaderState> implements IDetailsHeader {
  public static defaultProps = {
    selectAllVisibility: SelectAllVisibility.visible,
    collapseAllVisibility: CollapseAllVisibility.visible
  };
  private _rootElement: HTMLElement | undefined;
  private _rootComponent = createRef<IFocusZone>();
  private _id: string;
  private _draggedColumnIndex = -1;
  private _dropHintDetails: { [key: number]: IDropHintDetails } = {};
  private _dragDropHelper: DragDropHelper | null;
  private _currentDropHintIndex: number;
  private _subscriptionObject:
    {
      key: string;
      dispose(): void;
    };
  private _onDropIndexInfo: {
    sourceIndex: number;
    targetIndex: number;
  };
  constructor(props: IDetailsHeaderProps) {
    super(props);

    this.state = {
      columnResizeDetails: undefined,
      groupNestingDepth: this.props.groupNestingDepth,
      isAllCollapsed: this.props.isAllCollapsed
    };

    this._onToggleCollapseAll = this._onToggleCollapseAll.bind(this);
    this._onSelectAllClicked = this._onSelectAllClicked.bind(this);
    this._setDraggedItemIndex = this._setDraggedItemIndex.bind(this);
    this._onDragOver = this._onDragOver.bind(this);
    this._onDrop = this._onDrop.bind(this);
    this._getHeaderDragDropOptions = this._getHeaderDragDropOptions.bind(this);
    this._updateDroppingState = this._updateDroppingState.bind(this);
    this._getDropHintPositions = this._getDropHintPositions.bind(this);
    this._computeDropHintToBeShown = this._computeDropHintToBeShown.bind(this);
    this._resetDropHints = this._resetDropHints.bind(this);
    this._isValidCurrentDropHintIndex = this._isValidCurrentDropHintIndex.bind(this);
    this._onRootRef = this._onRootRef.bind(this);
    this._onDropIndexInfo = {
      sourceIndex: Number.MIN_SAFE_INTEGER,
      targetIndex: Number.MIN_SAFE_INTEGER
    };
    this._id = getId('header');
    this._currentDropHintIndex = Number.MIN_SAFE_INTEGER;
  }

  public componentDidMount(): void {
    const { selection, columnReorderOptions } = this.props;

    this._events.on(selection, SELECTION_CHANGE, this._onSelectionChanged);

    // We need to use native on this to avoid MarqueeSelection from handling the event before us.
    this._events.on(this._rootElement!, 'mousedown', this._onRootMouseDown);

    this._events.on(this._rootElement!, 'keydown', this._onRootKeyDown);

    if (columnReorderOptions) {
      this._subscriptionObject = this._dragDropHelper!.subscribe(this._rootElement!, this._events, this._getHeaderDragDropOptions());
    }
  }

  public componentDidUpdate(prevProps: IDetailsHeaderProps): void {
    const { columnReorderOptions } = this.props;

    if (!columnReorderOptions) {
      if (this._subscriptionObject) {
        this._subscriptionObject.dispose();
        delete this._subscriptionObject;
      }
    } else if (!this._subscriptionObject) {
      this._subscriptionObject = this._dragDropHelper!.subscribe(this._rootElement!, this._events, this._getHeaderDragDropOptions());
    }

    // TODO - should this be props[fn(targetIndex)] === prevProps[fn(sourceIndex)]? - DONE
    if (this.props !== prevProps && this._onDropIndexInfo.sourceIndex >= 0 && this._onDropIndexInfo.targetIndex >= 0) {
      if (prevProps.columns[this._onDropIndexInfo.sourceIndex].key === this.props.columns[this._onDropIndexInfo.targetIndex - 1].key) {
        this._onDropIndexInfo = {
          sourceIndex: Number.MIN_SAFE_INTEGER,
          targetIndex: Number.MIN_SAFE_INTEGER
        };
      }
    }
  }

  public componentWillReceiveProps(newProps: IDetailsHeaderProps): void {
    const { groupNestingDepth } = this.state;

    if (newProps.groupNestingDepth !== groupNestingDepth) {
      this.setState({ groupNestingDepth: newProps.groupNestingDepth });
    }
  }

  public componentWillUnmount(): void {
    if (this._subscriptionObject) {
      this._subscriptionObject.dispose();
      delete this._subscriptionObject;
    }
  }

  public render(): JSX.Element {
    const {
      columns,
      ariaLabel,
      ariaLabelForSelectAllCheckbox,
      selectAllVisibility,
      ariaLabelForSelectionColumn,
      indentWidth,
      viewport,
      columnReorderOptions,
      onColumnClick,
      onColumnContextMenu
    } = this.props;
    const { isAllSelected, columnResizeDetails, isSizing, groupNestingDepth, isAllCollapsed } = this.state;
    const showCheckbox = selectAllVisibility !== SelectAllVisibility.none;
    const isCheckboxHidden = selectAllVisibility === SelectAllVisibility.hidden;

    const { onRenderColumnHeaderTooltip = this._onRenderColumnHeaderTooltip } = this.props;
    if (!this._dragDropHelper && this.props.columnReorderOptions) {
      this._dragDropHelper = new DragDropHelper({
        selection: {
          getSelection: () => { return; }
        } as ISelection,
        minimumPixelsForDrag: this.props.minimumPixelsForDrag
      });
    }
    const frozenColumnCountFromStart = columnReorderOptions && columnReorderOptions!.frozenColumnCountFromStart ? columnReorderOptions!.frozenColumnCountFromStart! : 0;
    const frozenColumnCountFromEnd = columnReorderOptions && columnReorderOptions!.frozenColumnCountFromEnd ? columnReorderOptions!.frozenColumnCountFromEnd! : 0;

    return (
      <FocusZone
        role="row"
        aria-label={ariaLabel}
        className={css(
          'ms-DetailsHeader',
          styles.root,
          isAllSelected && ('is-allSelected ' + styles.rootIsAllSelected),
          (selectAllVisibility === SelectAllVisibility.hidden) && ('is-selectAllHidden ' + styles.rootIsSelectAllHidden),
          (!!columnResizeDetails && isSizing) && 'is-resizingColumn'
        )}
        componentRef={this._rootComponent}
        ref={this._onRootRef}
        onMouseMove={this._onRootMouseMove}
        data-automationid="DetailsHeader"
        style={{ minWidth: viewport ? viewport.width : 0 }}
        direction={FocusZoneDirection.horizontal}
      >
        {showCheckbox
          ? [
            <div
              key="__checkbox"
              className={css(
                'ms-DetailsHeader-cell',
                'ms-DetailsHeader-cellIsCheck',
                styles.cell,
                styles.cellIsCheck,
                checkStyles.owner,
                isAllSelected && checkStyles.isSelected
              )}
              aria-labelledby={`${this._id}-check`}
              onClick={this._onSelectAllClicked}
              aria-colindex={!isCheckboxHidden ? 1 : undefined}
              role={!isCheckboxHidden ? 'columnheader' : undefined}
            >
              {onRenderColumnHeaderTooltip(
                {
                  hostClassName: css(styles.checkTooltip),
                  id: `${this._id}-checkTooltip`,
                  setAriaDescribedBy: false,
                  content: ariaLabelForSelectAllCheckbox,
                  children: (
                    <DetailsRowCheck
                      id={`${this._id}-check`}
                      aria-label={ariaLabelForSelectionColumn}
                      aria-describedby={`${this._id}-checkTooltip`}
                      data-is-focusable={!isCheckboxHidden}
                      isHeader={true}
                      selected={isAllSelected}
                      anySelected={false}
                      canSelect={!isCheckboxHidden}
                    />
                  )
                },
                this._onRenderColumnHeaderTooltip
              )}
            </div>,
            ariaLabelForSelectAllCheckbox && !this.props.onRenderColumnHeaderTooltip ? (
              <label key="__checkboxLabel" id={`${this._id}-checkTooltip`} className={styles.accessibleLabel}>
                {ariaLabelForSelectAllCheckbox}
              </label>
            ) : null
          ]
          : null}
        {groupNestingDepth! > 0 && this.props.collapseAllVisibility === CollapseAllVisibility.visible ? (
          <div
            className={css('ms-DetailsHeader-cell', styles.cell)}
            onClick={this._onToggleCollapseAll}
            data-is-focusable={true}
          >
            <Icon
              className={css(
                'ms-DetailsHeader-collapseButton',
                styles.collapseButton,
                isAllCollapsed && 'is-collapsed ' + styles.collapseButtonIsCollapsed
              )}
              iconName="ChevronDown"
            />
          </div>
        ) : null}
        <GroupSpacer indentWidth={indentWidth} count={groupNestingDepth! - 1} />
        {
          columns.map((column: IColumn, columnIndex: number) => {
            const _isDraggable = dragDropColumnEvents! && columnIndex >= this.props.frozenColumnCount!;
            return (
              [(
                <DetailsColumn
                  column={column}
                  key={column.key}
                  columnIndex={(showCheckbox ? 2 : 1) + columnIndex}
                  parentId={this._id}
                  isDraggable={_isDraggable}
                  dragDropColumnEvents={dragDropColumnEvents}
                  dragDropHelper={this._dragDropHelper}
                  onColumnClick={onColumnClick}
                  onColumnContextMenu={onColumnContextMenu}
                />
                /* <div
                  key={ column.key }
                  role='columnheader'
                  aria-sort={ column.isSorted ? (column.isSortedDescending ? 'descending' : 'ascending') : 'none' }
                  aria-disabled={ column.columnActionsMode === ColumnActionsMode.disabled }
                  aria-colindex={ (showCheckbox ? 1 : 0) + columnIndex }
                  className={ css(
                    'ms-DetailsHeader-cell',
                    droppingClassName,
                    styles.cell,
                    column.headerClassName,
                    (column.columnActionsMode !== ColumnActionsMode.disabled) && ('is-actionable ' + styles.cellIsActionable),
                    !column.name && ('is-empty ' + styles.cellIsEmpty),
                    (column.isSorted || column.isGrouped || column.isFiltered) && 'is-icon-visible',
                    column.isPadded && styles.cellWrapperPadded
                  ) }
                  data-is-draggable={ isDraggable }
                  draggable={ isDraggable }

                  style={ { width: column.calculatedWidth! + INNER_PADDING + (column.isPadded ? ISPADDED_WIDTH : 0) } }
                  data-automationid='ColumnsHeaderColumn'
                  data-item-key={ column.key }
                >
                  {
                    onRenderColumnHeaderTooltip({
                      hostClassName: css(styles.cellTooltip),
                      id: `${this._id}-${column.key}-tooltip`,
                      setAriaDescribedBy: false,
                      content: column.columnActionsMode !== ColumnActionsMode.disabled ? column.ariaLabel : '',
                      children: (
                        <span
                          id={ `${this._id}-${column.key}` }
                          aria-label={ column.isIconOnly ? column.name : undefined }
                          aria-labelledby={ column.isIconOnly ? undefined : `${this._id}-${column.key}-name ` }
                          className={ css('ms-DetailsHeader-cellTitle', styles.cellTitle) }
                          data-is-focusable={ column.columnActionsMode !== ColumnActionsMode.disabled }
                          role={ column.columnActionsMode !== ColumnActionsMode.disabled ? 'button' : undefined }
                          aria-describedby={ `${this._id}-${column.key}-tooltip` }
                          onContextMenu={ this._onColumnContextMenu.bind(this, column) }
                          onClick={ this._onColumnClick.bind(this, column) }
                          aria-haspopup={ column.columnActionsMode === ColumnActionsMode.hasDropdown }
                        >
                          <span
                            id={ `${this._id}-${column.key}-name` }
                            className={ css('ms-DetailsHeader-cellName',
                              styles.cellName, {
                                [styles.iconOnlyHeader]: column.isIconOnly
                              }) }
                          >
                            { (column.iconName || column.iconClassName) && (
                              <Icon className={ css(styles.nearIcon, column.iconClassName) } iconName={ column.iconName } />
                            ) }

                            { !column.isIconOnly ? column.name : undefined }
                          </span>

                          { column.isFiltered && (
                            <Icon className={ styles.nearIcon } iconName='Filter' />
                          ) }

                          { column.isSorted && (
                            <Icon className={ css(styles.nearIcon, styles.sortIcon) } iconName={ column.isSortedDescending ? 'SortDown' : 'SortUp' } />
                          ) }

                          { column.isGrouped && (
                            <Icon className={ styles.nearIcon } iconName='GroupedDescending' />
                          ) }

                          { column.columnActionsMode === ColumnActionsMode.hasDropdown && !column.isIconOnly && (
                            <Icon
                              className={ css('ms-DetailsHeader-filterChevron', styles.filterChevron) }
                              iconName='ChevronDown'
                            />
                          ) }
                        </span>
                      )
                    }, this._onRenderColumnHeaderTooltip)
                  }
                </div>,
                column.ariaLabel && !this.props.onRenderColumnHeaderTooltip ? (
                  <label
                    key={ `${column.key}_label` }
                    id={ `${this._id}-${column.key}-tooltip` }
                    className={ styles.accessibleLabel }
                  >
                    { column.ariaLabel }
                  </label>
                ) : null,*/
              ),
              column.isResizable && this._renderColumnSizer(columnIndex)
              ];
        )
        })}
        {isSizing && (
          <Layer>
            <div
              className={css(isSizing && styles.sizingOverlay)}
              onMouseMove={this._onSizerMouseMove}
              onMouseUp={this._onSizerMouseUp}
            />
          </Layer>
        )}
      </FocusZone>
    );
  }

  /** Set focus to the active thing in the focus area. */
  public focus(): boolean {
    return Boolean(this._rootComponent.current && this._rootComponent.current.focus());
  }

  private _getHeaderDragDropOptions(): IDragDropOptions {
    const {
      dragDropColumnEvents
    } = this.props;
    const dataContext: IDragDropContext = { data: this, index: 1 };
    const options = {
      selectionIndex: 1,
      context: { data: this, index: 0 },
      canDrag: () => false,
      canDrop: () => true,
      onDragStart: () => undefined,
      updateDropState: this._updateDroppingState,
      onDrop: this._onDrop,
      onDragEnd: () => undefined,
      onDragOver: this._onDragOver
    };
    return options;
  }

  private _updateDroppingState(newValue: boolean, event: DragEvent): void {
    if (this._draggedColumnIndex >= 0 && event.type !== 'drop') {
      if (!newValue) {
        this._resetDropHints();
      }
    }
  }

  private _isValidCurrentDropHintIndex() {
    return (this._currentDropHintIndex! >= 0);
  }

  private _onDragOver(item: any, event: DragEvent): void {
    if (this._draggedColumnIndex >= 0) {
      event.stopPropagation();
      this._computeDropHintToBeShown(event.clientX);
    }
  }

  private _onDrop(item?: any, event?: DragEvent): void {
    const draggedColumnIndex = this._draggedColumnIndex;
    const dropIndex = this._currentDropHintIndex!;
    let isValidDrop = false;
    if (this._draggedColumnIndex >= 0 && event! instanceof DragEvent) {
      event!.stopPropagation();
      if (this._isValidCurrentDropHintIndex()) {
        isValidDrop = true;
        this._onDropIndexInfo.sourceIndex = draggedColumnIndex;
        // Target index will not get changed if draggeditem is before target item.
        this._onDropIndexInfo.targetIndex = dropIndex + ((draggedColumnIndex > dropIndex!) ? 1 : 0);
      }
      this._resetDropHints();
      this._dropHintDetails = {};
      this._draggedColumnIndex = -1;
      if (isValidDrop) {
        this.props.columnReorderOptions!.handleColumnReorder(draggedColumnIndex, dropIndex);
      }

      this._resetDropHints();
      this._draggedColumnIndex = -1;
    }
  }

  private _setDraggedItemIndex(itemIndex: number) {
    if (itemIndex >= 0) {
      this._draggedColumnIndex = (this.props.selectionMode !== SelectionMode.none) ? itemIndex! - 1 : itemIndex;
      this._getDropHintPositions();
    } else {
      this._resetDropHints();
      this._draggedColumnIndex = -1;
      this._dropHintDetails = {};
    }

  private _resetDropHints(): void {
    if (this._currentDropHintIndex >= 0) {
      this._updateDropHintElement(this._dropHintDetails[this._currentDropHintIndex].dropHintElementRef, 'none');
      this._currentDropHintIndex = Number.MIN_SAFE_INTEGER;
    }

  }
}

  private _updateDropHintElement(element: HTMLElement, property: string) {
  (element.childNodes[1] as HTMLElement).style.display = property;
  (element.childNodes[0] as HTMLElement).style.display = property;
}

  private _getDropHintPositions = (): void => {
  const { columnReorderOptions, columns } = this.props;
  let prevX = 0;
  let prevMid = 0;
  let prevRef: HTMLElement;
  const frozenColumnCountFromStart = (columnReorderOptions && columnReorderOptions!.frozenColumnCountFromStart) ? columnReorderOptions!.frozenColumnCountFromStart : 0;
  const frozenColumnCountFromEnd = (columnReorderOptions && columnReorderOptions!.frozenColumnCountFromEnd) ? columnReorderOptions!.frozenColumnCountFromEnd : 0;
  for (let i = frozenColumnCountFromStart!; i < columns.length - frozenColumnCountFromEnd! + 1; i++) {
    const dropHintElement = this._rootElement!.querySelectorAll('#columnDropHint_' + i)[0] as HTMLElement;
    if (dropHintElement) {
      if (i === frozenColumnCountFromStart!) {
        prevX = dropHintElement!.offsetLeft;
        prevMid = dropHintElement!.offsetLeft;
        prevRef = dropHintElement;
      } else {
        const newMid = ((dropHintElement!.offsetLeft + prevX!) / 2);
        this._dropHintDetails[i - 1] = { originX: prevX, startX: prevMid!, endX: newMid, dropHintElementRef: prevRef! };
        prevMid = newMid;
        prevRef = dropHintElement;
        prevX = dropHintElement!.offsetLeft;
        if (i === columns.length - frozenColumnCountFromEnd!) {
          this._dropHintDetails[i] = { originX: prevX, startX: prevMid!, endX: dropHintElement!.offsetLeft, dropHintElementRef: prevRef };
        }
      }
    }
  }
}

/**
 * Based on the given cursor position, finds the nearest drop hint and updates the state to make it visible
 *
 */
  private _computeDropHintToBeShown = (clientX: number): void => {
  const clientRect = this._rootElement!.getBoundingClientRect();
  const headerOriginX = clientRect.left;
  const eventXRelativePosition = clientX - headerOriginX;
  const currentDropHintIndex = this._currentDropHintIndex!;
  if (this._isValidCurrentDropHintIndex()) {
    if (eventXRelativePosition >= this._dropHintDetails[currentDropHintIndex!].startX && eventXRelativePosition <= this._dropHintDetails[currentDropHintIndex!].endX) {
      return;
    }
  }
  const { columnReorderOptions, columns } = this.props;
  const frozenColumnCountFromStart = (columnReorderOptions && columnReorderOptions!.frozenColumnCountFromStart) ? columnReorderOptions!.frozenColumnCountFromStart : 0;
  const frozenColumnCountFromEnd = (columnReorderOptions && columnReorderOptions!.frozenColumnCountFromEnd) ? columnReorderOptions!.frozenColumnCountFromEnd : 0;
  const currentIndex: number = frozenColumnCountFromStart!;
  const lastValidColumn = columns.length - frozenColumnCountFromEnd!;
  let indexToUpdate = -1;
  if (eventXRelativePosition <= this._dropHintDetails[currentIndex].endX) {
    indexToUpdate = currentIndex;
  } else if (eventXRelativePosition >= this._dropHintDetails[lastValidColumn]!.startX) {
    indexToUpdate = lastValidColumn;
  } else if (this._isValidCurrentDropHintIndex()) {
    if (this._dropHintDetails[currentDropHintIndex! + 1] && eventXRelativePosition >= this._dropHintDetails[currentDropHintIndex! + 1].startX && eventXRelativePosition <= this._dropHintDetails[currentDropHintIndex! + 1].endX) {
      indexToUpdate = currentDropHintIndex! + 1;
    } else if (this._dropHintDetails[currentDropHintIndex! - 1] && eventXRelativePosition >= this._dropHintDetails[currentDropHintIndex! - 1].startX && eventXRelativePosition <= this._dropHintDetails[currentDropHintIndex! - 1].endX) {
      indexToUpdate = currentDropHintIndex! - 1;
    }
  }
  if (indexToUpdate === -1) {
    let startIndex = frozenColumnCountFromStart!;
    let endIndex = lastValidColumn;
    while (startIndex < endIndex) {
      const middleIndex = Math.ceil((endIndex + startIndex!) / 2);
      if (eventXRelativePosition >= this._dropHintDetails[middleIndex].startX && eventXRelativePosition <= this._dropHintDetails[middleIndex].endX) {
        indexToUpdate = middleIndex;
        break;
      } else if (eventXRelativePosition < this._dropHintDetails[middleIndex]!.originX) {
        endIndex = middleIndex;
      } else if (eventXRelativePosition > this._dropHintDetails[middleIndex]!.originX) {
        startIndex = middleIndex;
      }
    }
  }
  if (dropHintsState) {
    const newDropHintState = dropHintsState.map(state => false);
    newDropHintState[indexToUpdate] = true;
    this.setState({ dropHintsState: newDropHintState });
  }

  if (indexToUpdate === this._draggedColumnIndex || indexToUpdate === this._draggedColumnIndex + 1) {
    if (this._isValidCurrentDropHintIndex()) {
      this._resetDropHints();
    }
  } else if (currentDropHintIndex !== indexToUpdate && indexToUpdate !== -1) {
    this.setState({ currentDropHintIndex: indexToUpdate });
  }
}

  private _renderColumnSizer(columnIndex: number): JSX.Element {
  const { columns } = this.props;
  const column = this.props.columns[columnIndex];
  const { columnResizeDetails } = this.state;

  return (
    <div
      key={`${column.key}_sizer`}
      aria-hidden={true}
      role="button"
      data-is-focusable={false}
      onClick={stopPropagation}
      data-sizer-index={columnIndex}
      onBlur={this._onSizerBlur}
      className={css(
        'ms-DetailsHeader-cellSizer',
        styles.cellSizer,
        columnIndex < columns.length - 1 ? styles.cellSizerStart : styles.cellSizerEnd,
        {
          ['is-resizing ' + styles.cellIsResizing]: columnResizeDetails && columnResizeDetails.columnIndex === columnIndex
        })}
      onDoubleClick={this._onSizerDoubleClick.bind(this, columnIndex)}
    />
  );
}

  private _renderDropHint(dropHintIndex: number): JSX.Element {
  return (
    <div
      key={`columndropHint`}
      aria-hidden={true}
      data-is-focusable={false}
      data-sizer-index={dropHintIndex}
      id={`columnDropHint_${dropHintIndex}`}
      className={css(
        'ms-DetailsHeader-dropHint',
        styles.dropHint,
        {
          //  TODO add CSS changes to show drop hint
          ['is-dropping ' + styles.isDropping]: this.state.dropHintsState![dropHintIndex]
        }
      )}
      onDoubleClick={this._onSizerDoubleClick.bind(this, columnIndex)}
    />
  );
}

  private _onRenderColumnHeaderTooltip = (
  tooltipHostProps: ITooltipHostProps,
  defaultRender?: IRenderFunction<ITooltipHostProps>
): JSX.Element => {
  return <span className={tooltipHostProps.hostClassName}>{tooltipHostProps.children}</span>;
};

  /**
   * double click on the column sizer will auto ajust column width
   * to fit the longest content among current rendered rows.
   *
   * @private
* @param {number} columnIndex (index of the column user double clicked)
* @param {React.MouseEvent} ev (mouse double click event)
      */
  private _onSizerDoubleClick(columnIndex: number, ev: React.MouseEvent<HTMLElement>): void {
  const { onColumnAutoResized, columns } = this.props;
  if(onColumnAutoResized) {
    onColumnAutoResized(columns[columnIndex], columnIndex);
  }
}

  /**
   * Called when the select all toggle is clicked.
   */
  private _onSelectAllClicked = (): void => {
    const { selection } = this.props;

    selection.toggleAllSelected();
  };

  private _onRootMouseDown = (ev: MouseEvent): void => {
  const columnIndexAttr = (ev.target as HTMLElement).getAttribute('data-sizer-index');
  const columnIndex = Number(columnIndexAttr);
  const { columns } = this.props;

  if (columnIndexAttr === null || ev.button !== MOUSEDOWN_PRIMARY_BUTTON) {
    // Ignore anything except the primary button.
    return;
  }

  this.setState({
    columnResizeDetails: {
      columnIndex: columnIndex,
      columnMinWidth: columns[columnIndex].calculatedWidth!,
      originX: ev.clientX
    }
  });

  ev.preventDefault();
  ev.stopPropagation();
};

  private _onRootMouseMove = (ev: React.MouseEvent<HTMLElement>): void => {
  const { columnResizeDetails, isSizing } = this.state;

  if (columnResizeDetails && !isSizing && ev.clientX !== columnResizeDetails.originX) {
    this.setState({ isSizing: true });
  }
};

  private _onRootKeyDown = (ev: KeyboardEvent): void => {
  const { columnResizeDetails, isSizing } = this.state;
  const { columns, onColumnResized } = this.props;

  const columnIndexAttr = (ev.target as HTMLElement).getAttribute('data-sizer-index');

  if (!columnIndexAttr || isSizing) {
    return;
  }

  const columnIndex = Number(columnIndexAttr);

  if (!columnResizeDetails) {
    if (ev.which === KeyCodes.enter) {
      this.setState({
        columnResizeDetails: {
          columnIndex: columnIndex,
          columnMinWidth: columns[columnIndex].calculatedWidth!
        }
      });

      ev.preventDefault();
      ev.stopPropagation();
    }
  } else {
    let increment: number | undefined;

    if (ev.which === KeyCodes.enter) {
      this.setState({
        columnResizeDetails: undefined
      });

      ev.preventDefault();
      ev.stopPropagation();
    } else if (ev.which === KeyCodes.left) {
      increment = getRTL() ? 1 : -1;
    } else if (ev.which === KeyCodes.right) {
      increment = getRTL() ? -1 : 1;
    }

    if (increment) {
      if (!ev.shiftKey) {
        increment *= 10;
      }

      this.setState({
        columnResizeDetails: {
          ...columnResizeDetails,
          columnMinWidth: columnResizeDetails.columnMinWidth + increment
        }
      });

      if (onColumnResized) {
        onColumnResized(columns[columnIndex], columnResizeDetails.columnMinWidth + increment, columnIndex);
      }

      ev.preventDefault();
      ev.stopPropagation();
    }
  }
};

  /**
   * mouse move event handler in the header
   * it will set isSizing state to true when user clicked on the sizer and move the mouse.
   *
   * @private
* @param {React.MouseEvent} ev (mouse move event)
                              */
  private _onSizerMouseMove = (ev: React.MouseEvent<HTMLElement>): void => {
  const {
    // use buttons property here since ev.button in some edge case is not upding well during the move.
    // but firefox doesn't support it, so we set the default value when it is not defined.
    buttons
  } = ev;
  const { onColumnIsSizingChanged, onColumnResized, columns } = this.props;
  const { columnResizeDetails } = this.state;

  if (buttons !== undefined && buttons !== MOUSEMOVE_PRIMARY_BUTTON) {
    // cancel mouse down event and return early when the primary button is not pressed
    this._onSizerMouseUp(ev);
    return;
  }

  if (ev.clientX !== columnResizeDetails!.originX) {
    if (onColumnIsSizingChanged) {
      onColumnIsSizingChanged(columns[columnResizeDetails!.columnIndex], true);
    }
  }

  if (onColumnResized) {
    let movement = ev.clientX - columnResizeDetails!.originX!;

    if (getRTL()) {
      movement = -movement;
    }

    onColumnResized(
      columns[columnResizeDetails!.columnIndex],
      columnResizeDetails!.columnMinWidth + movement,
      columnResizeDetails!.columnIndex
    );
  }
};

  private _onSizerBlur = (ev: React.FocusEvent<HTMLElement>): void => {
  const { columnResizeDetails } = this.state;

  if (columnResizeDetails) {
    this.setState({
      columnResizeDetails: undefined,
      isSizing: false
    });
  }
};

  /**
   * mouse up event handler in the header
   * clear the resize related state.
   * This is to ensure we can catch double click event
   *
   * @private
* @param {React.MouseEvent} ev (mouse up event)
                                  */
  private _onSizerMouseUp = (ev: React.MouseEvent<HTMLElement>): void => {
  const { columns, onColumnIsSizingChanged } = this.props;
  const { columnResizeDetails } = this.state;

  this.setState({
    columnResizeDetails: undefined,
    isSizing: false
  });

  if (onColumnIsSizingChanged) {
    onColumnIsSizingChanged(columns[columnResizeDetails!.columnIndex], false);
  }
};

  private _onSelectionChanged(): void {
  const isAllSelected = this.props.selection.isAllSelected();

  if(this.state.isAllSelected !== isAllSelected) {
  this.setState({
    isAllSelected: isAllSelected
  });
}
  }

  private _onToggleCollapseAll(): void {
  const { onToggleCollapseAll } = this.props;
  const newCollapsed = !this.state.isAllCollapsed;
  this.setState({
    isAllCollapsed: newCollapsed
  });
  if(onToggleCollapseAll) {
    onToggleCollapseAll(newCollapsed);
  }
}
}

function stopPropagation(ev: React.MouseEvent<HTMLElement>): void {
  ev.stopPropagation();
}
